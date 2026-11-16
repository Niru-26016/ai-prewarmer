import { env } from 'cloudflare:workers';
import {
  runInDurableObject,
  runDurableObjectAlarm,
  evictDurableObject,
  reset,
} from 'cloudflare:test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import worker from '../src/worker';
const fakeAuth = {
  auth_mode: 'chatgpt',
  tokens: {
    refresh_token: 'fake-refresh-token-never-real',
    access_token: 'fake-access-token-never-real',
  },
};
let now: number;
beforeEach(async () => {
  now = Date.parse('2030-01-06T12:00:00Z');
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  await mode(env.STATE.getByName('reset-config'), {
    DRY_RUN: 'true',
    ENABLE_LIVE_RUNS: 'false',
    ALLOW_CODEX_CONNECTION: 'false',
    EXECUTOR: 'mock',
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await reset();
});
const object = () => env.STATE.getByName(crypto.randomUUID());
async function mode(stub, settings) {
  await runInDurableObject(stub, (instance) => {
    Object.assign(instance.env, settings);
  });
}
async function rejection(promise) {
  try {
    await promise;
    return '';
  } catch (e) {
    return e.message;
  }
}
async function changeJob(stub, id, patch) {
  await runInDurableObject(stub, (_instance, state) => {
    const j = JSON.parse(
      state.storage.sql.exec('SELECT data FROM jobs WHERE id = ?', id).one().data,
    );
    state.storage.sql.exec(
      'UPDATE jobs SET data = ? WHERE id = ?',
      JSON.stringify({ ...j, ...patch }),
      id,
    );
  });
}
async function dispatched(stub) {
  const result = await stub.createJob(crypto.randomUUID());
  await changeJob(stub, result.job.id, { status: 'dispatched' });
  return result.job.id;
}

it('creates, edits, disables, deletes and persists weekly schedules through eviction', async () => {
  const s = object();
  const rule = await s.saveSchedule({
    days: [1, 3],
    time: '00:10',
    label: 'Week start',
    enabled: true,
  });
  expect(rule.nextAt).toBe(Date.parse('2030-01-06T18:40:00Z'));
  await s.saveSchedule({ ...rule, enabled: false }, rule.id);
  expect((await s.snapshot()).nextAt).toBeNull();
  await evictDurableObject(s);
  expect((await s.snapshot()).schedules[0].label).toBe('Week start');
  await s.deleteSchedule(rule.id);
  expect((await s.snapshot()).schedules).toHaveLength(0);
  expect(await rejection(s.deleteSchedule(rule.id))).toContain('SCHEDULE_NOT_FOUND');
});
it('one run wins concurrent manual requests; the same key replays its job', async () => {
  const s = object(),
    key = crypto.randomUUID();
  const results = await Promise.allSettled([
    s.createJob(key),
    ...Array.from({ length: 5 }, () => s.createJob(crypto.randomUUID())),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const first = await s.createJob(key);
  expect((await s.snapshot()).jobs).toHaveLength(1);
  expect(first.job.id).toBe((await s.snapshot()).active.id);
});
it('mock runner progresses queued to running to succeeded without credentials', async () => {
  const s = object();
  await s.createJob(crypto.randomUUID());
  now += 100;
  await runDurableObjectAlarm(s);
  expect((await s.snapshot()).jobs[0].status).toBe('running');
  now += 1600;
  await runDurableObjectAlarm(s);
  const data = await s.snapshot();
  expect(data.jobs[0].status).toBe('succeeded');
  expect(data.authReady).toBe(false);
  expect(data.active).toBeNull();
});
it('duplicate alarm delivery produces a single scheduled job and advances the alarm', async () => {
  const s = object(),
    rule = await s.saveSchedule({ days: [0], time: '17:30', enabled: true });
  now = rule.nextAt;
  await runDurableObjectAlarm(s);
  await runDurableObjectAlarm(s);
  const data = await s.snapshot();
  expect(data.jobs).toHaveLength(1);
  expect(data.schedules[0].nextAt).toBe(now + 7 * 86400000);
});
it('coincident alarms record an overlap skip; stale alarms never launch late requests', async () => {
  const s = object();
  const a = await s.saveSchedule({ days: [0], time: '17:30' });
  await s.saveSchedule({ days: [0], time: '17:30' });
  now = a.nextAt;
  await runDurableObjectAlarm(s);
  expect((await s.snapshot()).jobs.map((j) => j.status).sort()).toEqual(['queued', 'skipped']);
  now += 8 * 86400000;
  await runDurableObjectAlarm(s);
  expect((await s.snapshot()).jobs.some((j) => j.error === 'MISSED_SCHEDULE')).toBe(true);
});
it('claim is bound to a job and single use; finished callbacks are idempotent', async () => {
  const s = object(),
    id = await dispatched(s),
    token = 'c'.repeat(64);
  expect(await rejection(s.claim(crypto.randomUUID(), token))).toContain('CLAIM_UNAVAILABLE');
  expect((await s.claim(id, token)).dryRun).toBe(true);
  expect(await rejection(s.claim(id, token))).toContain('CLAIM_UNAVAILABLE');
  expect(await rejection(s.finish(id, 'z'.repeat(64), { ok: true }))).toContain(
    'CLAIM_UNAVAILABLE',
  );
  expect(await s.finish(id, token, { ok: true })).toEqual({ ok: true, replayed: false });
  expect(await s.finish(id, token, { ok: true })).toEqual({ ok: true, replayed: true });
  expect(await rejection(s.finish(id, token, { ok: false }))).toContain('FINISH_UNAVAILABLE');
});
it('expired queued work rejects late claim', async () => {
  const s = object(),
    id = await dispatched(s);
  now += 601000;
  expect(await rejection(s.claim(id, 'c'.repeat(64)))).toContain('CLAIM_UNAVAILABLE');
  expect((await s.snapshot()).jobs[0].error).toBe('RUNNER_TIMEOUT');
});
it('dry-run connection is locked and never accepts credential writeback', async () => {
  const s = object();
  expect(await rejection(s.storeAuth(fakeAuth))).toContain('CODEX_CONNECTION_LOCKED');
  const id = await dispatched(s),
    token = 'c'.repeat(64);
  await s.claim(id, token);
  expect(await rejection(s.finish(id, token, { ok: true, authJson: fakeAuth }))).toContain(
    'DRY_RUN_CREDENTIALS_FORBIDDEN',
  );
});
it('fake refreshed credentials persist even on failure; expiration requires reconnect', async () => {
  const s = object();
  await mode(s, {
    ALLOW_CODEX_CONNECTION: 'true',
    DRY_RUN: 'false',
    ENABLE_LIVE_RUNS: 'true',
    EXECUTOR: 'cloud_run',
  });
  await s.storeAuth(fakeAuth);
  const id = await dispatched(s),
    token = 'c'.repeat(64);
  expect(await rejection(s.claim(id, token))).toContain('LIVE_RUN_NOT_AUTHORIZED');
  expect((await s.claim(id, token, true)).authJson.tokens.access_token).toContain('fake-');
  expect(await rejection(s.storeAuth(fakeAuth))).toContain('RUN_ACTIVE');
  const updated = {
    ...fakeAuth,
    tokens: { ...fakeAuth.tokens, access_token: 'fake-refreshed-access' },
  };
  await s.finish(id, token, { ok: false, authJson: updated, reconnect: true });
  expect((await s.snapshot()).credentialState).toBe('reconnect_required');
  expect(await rejection(s.createJob(crypto.randomUUID()))).toContain('CODEX_RECONNECT_REQUIRED');
  const stored = await runInDurableObject(
    s,
    (_instance, state) =>
      state.storage.sql.exec("SELECT data FROM metadata WHERE key='credential'").one().data,
  );
  expect(stored).not.toContain('fake-refreshed-access');
  await s.storeAuth(updated);
  expect((await s.snapshot()).authReady).toBe(true);
});
it('lost live writeback quarantines credentials and blocks stale completion', async () => {
  const s = object();
  await mode(s, {
    ALLOW_CODEX_CONNECTION: 'true',
    DRY_RUN: 'false',
    ENABLE_LIVE_RUNS: 'true',
    EXECUTOR: 'cloud_run',
  });
  await s.storeAuth(fakeAuth);
  const id = await dispatched(s),
    token = 'c'.repeat(64);
  await s.claim(id, token, true);
  now += 181000;
  expect((await s.snapshot()).credentialState).toBe('quarantined');
  expect(await rejection(s.finish(id, token, { ok: true, authJson: fakeAuth }))).toContain(
    'FINISH_UNAVAILABLE',
  );
  expect(await rejection(s.createJob(crypto.randomUUID()))).toContain('CODEX_RECONNECT_REQUIRED');
});
it('missing Cloud Run configuration fails dispatch without a retry', async () => {
  const s = object();
  await mode(s, { EXECUTOR: 'cloud_run' });
  // Missing provider configuration is a definitive failure.
  await s.createJob(crypto.randomUUID());
  now += 100;
  await runDurableObjectAlarm(s);
  expect((await s.snapshot()).jobs[0].status).toBe('failed');
});
it('SQL schema initialization is repeatable across multiple evictions', async () => {
  const s = object();
  await s.snapshot();
  await evictDurableObject(s);
  await s.snapshot();
  await evictDurableObject(s);
  const versions = await runInDurableObject(s, (_i, state) =>
    state.storage.sql.exec('SELECT version FROM schema_migrations').toArray(),
  );
  expect(versions).toEqual([{ version: 1 }]);
});

async function request(path, options = {}) {
  return worker.fetch(new Request('https://app.example' + path, options), env);
}
async function login() {
  const response = await request('/api/login', {
    method: 'POST',
    headers: { Origin: 'https://app.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'fake-dashboard-password-for-tests-only' }),
  });
  return {
    cookie: response.headers.get('Set-Cookie').split(';')[0],
    csrf: (await response.json()).csrf,
  };
}
it('HTTP rejects unauthenticated access, CSRF, cross-origin writes, and oversized streamed bodies', async () => {
  expect((await request('/api/status')).status).toBe(401);
  const session = await login();
  const headers = {
    Cookie: session.cookie,
    Origin: 'https://app.example',
    'X-CSRF-Token': session.csrf,
  };
  expect(
    (
      await request('/api/run', {
        method: 'POST',
        headers: { Cookie: session.cookie, Origin: 'https://app.example' },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await request('/api/run', {
        method: 'POST',
        headers: { ...headers, Origin: 'https://evil.invalid' },
      })
    ).status,
  ).toBe(403);
  expect((await request('/api/run', { method: 'POST', headers })).status).toBe(400);
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('x'.repeat(5000)));
      c.close();
    },
  });
  expect(
    (
      await request('/api/schedules', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: stream,
      })
    ).status,
  ).toBe(413);
});
it('logout revokes copied cookies; security headers and production cookie flags are set', async () => {
  const session = await login();
  expect(session.cookie).toMatch(/^prewarm_session=/);
  const response = await request('/api/logout', {
    method: 'POST',
    headers: {
      Cookie: session.cookie,
      Origin: 'https://app.example',
      'X-CSRF-Token': session.csrf,
    },
  });
  expect(response.headers.get('Set-Cookie')).toContain('Secure; SameSite=Strict');
  expect((await request('/api/session', { headers: { Cookie: session.cookie } })).status).toBe(401);
  expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
});
it('login is rate limited and runner secrets never authenticate browser APIs', async () => {
  for (let i = 0; i < 8; i++)
    await request('/api/login', {
      method: 'POST',
      headers: { Origin: 'https://app.example', 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'incorrect' }),
    });
  expect(
    (
      await request('/api/login', {
        method: 'POST',
        headers: { Origin: 'https://app.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'incorrect' }),
      })
    ).status,
  ).toBe(429);
  expect(
    (await request('/api/status', { headers: { Authorization: 'Bearer ' + 'r'.repeat(48) } }))
      .status,
  ).toBe(401);
});
it('HTTP exposes no wildcard CORS and refuses unbound runner-next requests', async () => {
  const response = await request('/api/runner/next', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + 'r'.repeat(48), 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(response.status).toBe(400);
  expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
});
it('invalid linked credentials return a client error without changing stored credentials', async () => {
  const s = env.STATE.getByName('personal');
  await mode(s, { ALLOW_CODEX_CONNECTION: 'true' });
  const session = await login();
  const headers = {
    Cookie: session.cookie,
    Origin: 'https://app.example',
    'X-CSRF-Token': session.csrf,
    'Content-Type': 'application/json',
  };
  const response = await request('/api/auth/seed', {
    method: 'POST',
    headers,
    body: JSON.stringify({ auth_mode: 'apikey', tokens: {} }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: 'INVALID_CODEX_AUTH' });
  expect((await s.snapshot()).authReady).toBe(false);
  await s.storeAuth(fakeAuth);
  const again = await request('/api/auth/seed', {
    method: 'POST',
    headers,
    body: JSON.stringify({ auth_mode: 'apikey', tokens: {} }),
  });
  expect(again.status).toBe(400);
  expect((await s.snapshot()).authReady).toBe(true);
});
it('VM discovery returns only a dispatched job ID and one concurrent runner can claim it', async () => {
  const s = object();
  await mode(s, { EXECUTOR: 'vm' });
  const { job } = await s.createJob(crypto.randomUUID());
  expect((await s.vmPoll(true)).jobId).toBeNull();
  now += 100;
  await runDurableObjectAlarm(s);
  expect(await s.vmPoll(true)).toEqual({ ok: true, jobId: job.id });
  const results = await Promise.allSettled([
    s.claim(job.id, 'a'.repeat(64)),
    s.claim(job.id, 'b'.repeat(64)),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await s.vmPoll(true)).jobId).toBeNull();
  expect((await s.snapshot()).vmRunner.online).toBe(true);
  now += 46_000;
  expect((await s.snapshot()).vmRunner.online).toBe(false);
});
it('VM polling is machine-authenticated and disabled for the cloud executor', async () => {
  const response = await request('/api/runner/vm-poll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowLive: true }),
  });
  expect(response.status).toBe(401);
  expect(await rejection(object().vmPoll(true))).toContain('VM_RUNNER_DISABLED');
});
it('turning live mode off blocks an already dispatched live VM job', async () => {
  const s = object();
  await mode(s, {
    EXECUTOR: 'vm',
    ALLOW_CODEX_CONNECTION: 'true',
    DRY_RUN: 'false',
    ENABLE_LIVE_RUNS: 'true',
  });
  await s.storeAuth(fakeAuth);
  const id = await dispatched(s);
  expect((await s.vmPoll(false)).jobId).toBeNull();
  await mode(s, { ENABLE_LIVE_RUNS: 'false' });
  expect((await s.vmPoll(true)).jobId).toBeNull();
  expect(await rejection(s.claim(id, 'c'.repeat(64), true))).toContain('LIVE_RUN_NOT_AUTHORIZED');
});
it('429 provider retries stop after three attempts without releasing duplicate claims', async () => {
  const s = object();
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  let binary = '';
  for (const b of der) binary += String.fromCharCode(b);
  await mode(s, {
    EXECUTOR: 'cloud_run',
    GCP_PROJECT: 'fake-project',
    GCP_REGION: 'asia-south1',
    GCP_JOB: 'fake-job',
    GCP_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: 'fake@example.invalid',
      private_key: '-----BEGIN PRIVATE KEY-----\n' + btoa(binary) + '\n-----END PRIVATE KEY-----',
    }),
  });
  let calls = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url).includes('oauth2')) return Response.json({ access_token: 'fake-google-token' });
    calls++;
    return new Response('', { status: 429 });
  });
  const created = await s.createJob(crypto.randomUUID());
  now += 100;
  await runDurableObjectAlarm(s);
  expect((await s.snapshot()).jobs[0].status).toBe('retrying');
  now += 2100;
  await runDurableObjectAlarm(s);
  now += 4100;
  await runDurableObjectAlarm(s);
  const data = await s.snapshot();
  expect(calls).toBe(3);
  expect(data.active).toBeNull();
  expect(data.jobs[0].id).toBe(created.job.id);
  expect(data.jobs[0].status).toBe('failed');
});
it('unexpected dispatch errors stay fenced and allow exactly one late bound runner', async () => {
  const s = object();
  await mode(s, {
    EXECUTOR: 'cloud_run',
    GCP_PROJECT: 'fake-project',
    GCP_REGION: 'asia-south1',
    GCP_JOB: 'fake-job',
    GCP_SERVICE_ACCOUNT_JSON: 'not-valid-json',
  });
  await s.createJob(crypto.randomUUID());
  now += 100;
  await runDurableObjectAlarm(s);
  const data = await s.snapshot();
  expect(data.jobs[0].status).toBe('dispatched');
  expect(data.jobs[0].error).toBe('DISPATCH_UNCERTAIN');
  expect(await rejection(s.createJob(crypto.randomUUID()))).toContain('RUN_ACTIVE');
  const token = 'c'.repeat(64);
  await s.claim(data.jobs[0].id, token);
  await s.finish(data.jobs[0].id, token, { ok: false });
  expect((await s.snapshot()).jobs[0].status).toBe('failed');
});
it('legacy KV schedules migrate once, preserving history and requiring credential review', async () => {
  const s = object();
  await s.snapshot();
  await runInDurableObject(s, async (_i, state) => {
    state.storage.sql.exec("DELETE FROM metadata WHERE key='legacyImported'");
    await state.storage.put('state', {
      schedules: [
        {
          id: crypto.randomUUID(),
          days: [1],
          time: '04:00',
          label: 'Legacy alarm',
          enabled: true,
          nextAt: Date.parse('2030-01-07T22:30:00Z'),
        },
      ],
      jobs: [],
      active: null,
    });
    await state.storage.put('auth', { v: 1, iv: 'fake', data: 'fake' });
  });
  await evictDurableObject(s);
  expect((await s.snapshot()).schedules[0].label).toBe('Legacy alarm');
  expect((await s.snapshot()).credentialState).toBe('reconnect_required');
  await evictDurableObject(s);
  expect((await s.snapshot()).schedules).toHaveLength(1);
});

it('usage-only jobs persist sanitized limits and keep credentials ready on quota failures', async () => {
  const s = object();
  await mode(s, {
    EXECUTOR: 'vm',
    DRY_RUN: 'false',
    ENABLE_LIVE_RUNS: 'true',
    ALLOW_CODEX_CONNECTION: 'true',
  });
  await s.storeAuth(fakeAuth);
  const j = (await s.createJob(crypto.randomUUID(), true)).job;
  await changeJob(s, j.id, { status: 'dispatched' });
  const claim = await s.claim(j.id, 'c'.repeat(64), true);
  expect(claim.usageOnly).toBe(true);
  await s.finish(j.id, 'c'.repeat(64), {
    ok: true,
    authJson: fakeAuth,
    limits: [
      {
        id: 'codex',
        primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1900000000 },
        secret: 'drop',
      },
    ],
  });
  expect((await s.snapshot()).usage.buckets[0].primary.usedPercent).toBe(25);
  expect(JSON.stringify((await s.snapshot()).usage)).not.toContain('secret');
  const next = await dispatched(s);
  await s.claim(next, 'd'.repeat(64), true);
  await s.finish(next, 'd'.repeat(64), {
    ok: false,
    authJson: fakeAuth,
    reconnect: false,
    error: 'RATE_LIMITED',
  });
  expect((await s.snapshot()).credentialState).toBe('ready');
  expect((await s.snapshot()).jobs[0].error).toBe('RATE_LIMITED');
});

it('quota failure overrides an incorrect reconnect flag only with safely returned credentials', async () => {
  const s = object();
  await mode(s, {
    EXECUTOR: 'vm',
    DRY_RUN: 'false',
    ENABLE_LIVE_RUNS: 'true',
    ALLOW_CODEX_CONNECTION: 'true',
  });
  await s.storeAuth(fakeAuth);
  const id = await dispatched(s);
  const token = 'c'.repeat(64);
  await s.claim(id, token, true);
  const result = {
    ok: false,
    authJson: {
      ...fakeAuth,
      tokens: { ...fakeAuth.tokens, access_token: 'fake-refreshed-access-token' },
    },
    reconnect: true,
    error: 'RATE_LIMITED',
  };
  await s.finish(id, token, result);
  expect((await s.snapshot()).credentialState).toBe('ready');
  expect((await s.snapshot()).jobs[0].error).toBe('RATE_LIMITED');
  expect((await s.finish(id, token, result)).replayed).toBe(true);
  const next = await dispatched(s);
  const claim = await s.claim(next, 'd'.repeat(64), true);
  expect(claim.authJson.tokens.access_token).toBe('fake-refreshed-access-token');
});

it.each([
  { label: 'missing', authJson: undefined },
  { label: 'malformed', authJson: { tokens: {} } },
])(
  'quota failure still requires reconnect with $label returned credentials',
  async ({ authJson }) => {
    const s = object();
    await mode(s, {
      EXECUTOR: 'vm',
      DRY_RUN: 'false',
      ENABLE_LIVE_RUNS: 'true',
      ALLOW_CODEX_CONNECTION: 'true',
    });
    await s.storeAuth(fakeAuth);
    const id = await dispatched(s);
    const token = 'c'.repeat(64);
    await s.claim(id, token, true);
    await s.finish(id, token, { ok: false, authJson, reconnect: false, error: 'RATE_LIMITED' });
    expect((await s.snapshot()).credentialState).toBe('reconnect_required');
    expect((await s.snapshot()).jobs[0].error).toBe('CODEX_RECONNECT_REQUIRED');
  },
);

it('HTTP allowance refresh creates an allowance job rather than a warmup', async () => {
  const s = env.STATE.getByName('personal');
  await mode(s, {
    EXECUTOR: 'vm',
    DRY_RUN: 'false',
    ENABLE_LIVE_RUNS: 'true',
    ALLOW_CODEX_CONNECTION: 'true',
  });
  await s.storeAuth(fakeAuth);
  const session = await login();
  const r = await request('/api/usage/refresh', {
    method: 'POST',
    headers: {
      Cookie: session.cookie,
      Origin: 'https://app.example',
      'X-CSRF-Token': session.csrf,
      'Idempotency-Key': crypto.randomUUID(),
    },
  });
  expect(r.status).toBe(202);
  expect((await r.json()).job.source).toBe('usage');
});

const usageInterval = 300_000;
async function liveUsageObject(s = object()) {
  await mode(s, {
    EXECUTOR: 'vm',
    DRY_RUN: 'false',
    ENABLE_LIVE_RUNS: 'true',
    ALLOW_CODEX_CONNECTION: 'true',
  });
  await s.storeAuth(fakeAuth);
  return s;
}

it('automatic limits checks default off and toggling is idempotent and durable', async () => {
  const s = await liveUsageObject();
  expect((await s.snapshot()).usageAutoRefresh).toEqual({
    enabled: false,
    intervalMs: usageInterval,
    nextAt: null,
  });
  const nextAt = now + usageInterval;
  await s.setUsageAutoRefresh(true);
  now += 10_000;
  await s.setUsageAutoRefresh(true);
  expect((await s.snapshot()).usageAutoRefresh).toEqual({
    enabled: true,
    intervalMs: usageInterval,
    nextAt,
  });
  expect(await runInDurableObject(s, (_instance, state) => state.storage.getAlarm())).toBe(nextAt);
  await evictDurableObject(s);
  expect((await s.snapshot()).usageAutoRefresh.nextAt).toBe(nextAt);
  await s.setUsageAutoRefresh(false);
  now += 10_000;
  await s.setUsageAutoRefresh(false);
  expect((await s.snapshot()).usageAutoRefresh).toEqual({
    enabled: false,
    intervalMs: usageInterval,
    nextAt: null,
  });
  expect(await runInDurableObject(s, (_instance, state) => state.storage.getAlarm())).toBeNull();
});

it.each([
  { label: 'mock executor', settings: { EXECUTOR: 'mock' }, auth: true },
  { label: 'cloud executor', settings: { EXECUTOR: 'cloud_run' }, auth: true },
  { label: 'dry run', settings: { DRY_RUN: 'true' }, auth: true },
  { label: 'live gate disabled', settings: { ENABLE_LIVE_RUNS: 'false' }, auth: true },
  { label: 'disconnected account', settings: {}, auth: false },
])('automatic limits cannot be enabled with $label', async ({ settings, auth }) => {
  const s = await liveUsageObject();
  await mode(s, settings);
  if (!auth) await s.removeAuth();
  expect(await rejection(s.setUsageAutoRefresh(true))).not.toBe('');
  expect((await s.snapshot()).usageAutoRefresh.enabled).toBe(false);
});

it('automatic limits check queues only a usage job and preserves refreshed credentials', async () => {
  const s = await liveUsageObject();
  await s.setUsageAutoRefresh(true);
  now += usageInterval;
  await s.vmPoll(true, true);
  await runDurableObjectAlarm(s);
  const queued = await s.snapshot();
  expect(queued.jobs).toHaveLength(1);
  expect(queued.jobs[0].source).toBe('usage');
  expect(queued.usageAutoRefresh.nextAt).toBe(now + usageInterval);
  now += 100;
  await runDurableObjectAlarm(s);
  const token = 'a'.repeat(64);
  const claim = await s.claim(queued.jobs[0].id, token, true);
  expect(claim.usageOnly).toBe(true);
  await s.finish(queued.jobs[0].id, token, {
    ok: true,
    authJson: {
      ...fakeAuth,
      tokens: { ...fakeAuth.tokens, access_token: 'fake-auto-refreshed-token' },
    },
    limits: [
      { id: 'codex', primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1900000000 } },
    ],
  });
  const done = await s.snapshot();
  expect(done.authReady).toBe(true);
  expect(done.jobs[0].status).toBe('succeeded');
  expect(done.usage.buckets[0].primary.usedPercent).toBe(100);
});

it('late and concurrent duplicate auto alarms create one job without interval catchup', async () => {
  const s = await liveUsageObject();
  await s.setUsageAutoRefresh(true);
  now += usageInterval * 5 + 1200;
  await s.vmPoll(true, true);
  await Promise.all(
    Array.from({ length: 3 }, () => runInDurableObject(s, (instance) => instance.alarm())),
  );
  const snapshot = await s.snapshot();
  expect(snapshot.jobs).toHaveLength(1);
  expect(snapshot.jobs[0].source).toBe('usage');
  expect(snapshot.usageAutoRefresh.nextAt).toBe(now + usageInterval);
});

it.each([
  { label: 'no heartbeat', heartbeat: null },
  { label: 'heartbeat exactly 45 seconds old', heartbeat: [true, true], staleMs: 45_000 },
  { label: 'runner live execution disabled', heartbeat: [false, true] },
  { label: 'old runner without usage support', heartbeat: [true, false] },
  { label: 'dry run turned on', heartbeat: [true, true], settings: { DRY_RUN: 'true' } },
  {
    label: 'live gate turned off',
    heartbeat: [true, true],
    settings: { ENABLE_LIVE_RUNS: 'false' },
  },
  { label: 'executor changed', heartbeat: [true, true], settings: { EXECUTOR: 'cloud_run' } },
  { label: 'account disconnected', heartbeat: [true, true], disconnect: true },
])(
  'automatic limits pause with $label and advance once',
  async ({ heartbeat, staleMs, settings, disconnect }) => {
    const s = await liveUsageObject();
    await s.setUsageAutoRefresh(true);
    now += usageInterval;
    if (heartbeat) {
      now -= staleMs ?? 0;
      await s.vmPoll(heartbeat[0], heartbeat[1]);
      now += staleMs ?? 0;
    }
    if (settings) await mode(s, settings);
    if (disconnect) await s.removeAuth();
    await runDurableObjectAlarm(s);
    const snapshot = await s.snapshot();
    expect(snapshot.jobs).toHaveLength(0);
    expect(snapshot.usageAutoRefresh.nextAt).toBe(now + usageInterval);
    await runInDurableObject(s, (instance) => instance.alarm());
    expect((await s.snapshot()).jobs).toHaveLength(0);
  },
);

it('automatic limits defer to an active job without queueing another', async () => {
  const s = await liveUsageObject();
  await s.setUsageAutoRefresh(true);
  const manual = await s.createJob(crypto.randomUUID());
  now += usageInterval;
  await s.vmPoll(true, true);
  await runDurableObjectAlarm(s);
  const snapshot = await s.snapshot();
  expect(snapshot.jobs).toHaveLength(1);
  expect(snapshot.jobs[0].id).toBe(manual.job.id);
  expect(snapshot.usageAutoRefresh.nextAt).toBe(now + usageInterval);
});

it.each(['queued', 'retrying', 'dispatched'])(
  'turning automatic limits off cancels its unclaimed %s job',
  async (status) => {
    const s = await liveUsageObject();
    await s.setUsageAutoRefresh(true);
    now += usageInterval;
    await s.vmPoll(true, true);
    await runDurableObjectAlarm(s);
    const id = (await s.snapshot()).jobs[0].id;
    await changeJob(s, id, { status });
    await s.setUsageAutoRefresh(false);
    const snapshot = await s.snapshot();
    expect(snapshot.active).toBeNull();
    expect(snapshot.jobs[0].status).toBe('skipped');
    expect(snapshot.jobs[0].error).toBe('AUTO_CHECK_DISABLED');
    expect(snapshot.usageAutoRefresh.nextAt).toBeNull();
    expect(await rejection(s.claim(id, 'a'.repeat(64), true))).toContain('CLAIM_UNAVAILABLE');
  },
);

it('turning automatic limits off lets its claimed job finish safely', async () => {
  const s = await liveUsageObject();
  await s.setUsageAutoRefresh(true);
  now += usageInterval;
  await s.vmPoll(true, true);
  await runDurableObjectAlarm(s);
  const id = (await s.snapshot()).jobs[0].id;
  now += 100;
  await runDurableObjectAlarm(s);
  const token = 'b'.repeat(64);
  await s.claim(id, token, true);
  await s.setUsageAutoRefresh(false);
  expect((await s.snapshot()).active.id).toBe(id);
  expect((await s.snapshot()).jobs[0].status).toBe('running');
  await s.finish(id, token, { ok: true, authJson: fakeAuth });
  const snapshot = await s.snapshot();
  expect(snapshot.jobs[0].status).toBe('succeeded');
  expect(snapshot.authReady).toBe(true);
  expect(snapshot.active).toBeNull();
  expect(snapshot.usageAutoRefresh.enabled).toBe(false);
});

it('turning automatic limits off leaves a manually requested usage job queued', async () => {
  const s = await liveUsageObject();
  await s.setUsageAutoRefresh(true);
  const manual = (await s.createUsageJob(crypto.randomUUID())).job;
  expect(manual.scheduledAt).toBeNull();
  await s.setUsageAutoRefresh(false);
  const snapshot = await s.snapshot();
  expect(snapshot.active.id).toBe(manual.id);
  expect(snapshot.jobs[0].status).toBe('queued');
  expect(snapshot.usageAutoRefresh.enabled).toBe(false);
});

it('an offline VM cannot leave an automatic usage job blocking a later due warmup', async () => {
  const s = await liveUsageObject();
  const rule = await s.saveSchedule({ days: [0], time: '17:39', enabled: true });
  await s.setUsageAutoRefresh(true);
  now += usageInterval;
  await s.vmPoll(true, true);
  await runDurableObjectAlarm(s);
  const autoId = (await s.snapshot()).active.id;
  now = rule.nextAt;
  await runDurableObjectAlarm(s);
  const snapshot = await s.snapshot();
  const automatic = snapshot.jobs.find((job) => job.id === autoId);
  const warmup = snapshot.jobs.find((job) => job.source === 'scheduled');
  expect(automatic.status).toBe('skipped');
  expect(warmup.status).toBe('queued');
  expect(warmup.error).toBeNull();
  expect(snapshot.active.id).toBe(warmup.id);
});

it('VM polling stops advertising an automatic usage job when a warmup approaches', async () => {
  const s = await liveUsageObject();
  await s.saveSchedule({ days: [0], time: '17:39', enabled: true });
  await s.setUsageAutoRefresh(true);
  now += usageInterval;
  await s.vmPoll(true, true);
  await runDurableObjectAlarm(s);
  now += 100;
  await runDurableObjectAlarm(s);
  const id = (await s.snapshot()).active.id;
  expect((await s.vmPoll(true, true)).jobId).toBe(id);
  now += 60_000;
  expect((await s.vmPoll(true, true)).jobId).toBeNull();
  const snapshot = await s.snapshot();
  expect(snapshot.active).toBeNull();
  expect(snapshot.jobs[0].status).toBe('skipped');
});

it('a delayed claim cannot retrieve credentials for automatic usage near a warmup', async () => {
  const s = await liveUsageObject();
  await s.saveSchedule({ days: [0], time: '17:39', enabled: true });
  await s.setUsageAutoRefresh(true);
  now += usageInterval;
  await s.vmPoll(true, true);
  await runDurableObjectAlarm(s);
  now += 100;
  await runDurableObjectAlarm(s);
  const id = (await s.vmPoll(true, true)).jobId;
  expect(id).not.toBeNull();
  now += 60_000;
  expect(await rejection(s.claim(id, 'd'.repeat(64), true))).toContain('CLAIM_UNAVAILABLE');
  const snapshot = await s.snapshot();
  expect(snapshot.jobs[0].status).toBe('skipped');
  expect(snapshot.active).toBeNull();
  expect(snapshot.authReady).toBe(true);
});

it('editing a warmup into the safety horizon cancels unclaimed automatic usage', async () => {
  const s = await liveUsageObject();
  const rule = await s.saveSchedule({ days: [0], time: '17:39', enabled: true });
  await s.setUsageAutoRefresh(true);
  now += usageInterval;
  await s.vmPoll(true, true);
  await runDurableObjectAlarm(s);
  await s.saveSchedule({ ...rule, time: '17:37' }, rule.id);
  const snapshot = await s.snapshot();
  expect(snapshot.jobs[0].status).toBe('skipped');
  expect(snapshot.active).toBeNull();
  expect(snapshot.authReady).toBe(true);
});

it('editing a warmup cannot release a running automatic usage credential claim', async () => {
  const s = await liveUsageObject();
  const rule = await s.saveSchedule({ days: [0], time: '17:39', enabled: true });
  await s.setUsageAutoRefresh(true);
  now += usageInterval;
  await s.vmPoll(true, true);
  await runDurableObjectAlarm(s);
  now += 100;
  await runDurableObjectAlarm(s);
  const id = (await s.vmPoll(true, true)).jobId;
  const token = 'e'.repeat(64);
  await s.claim(id, token, true);
  await s.saveSchedule({ ...rule, time: '17:37' }, rule.id);
  const snapshot = await s.snapshot();
  expect(snapshot.active.id).toBe(id);
  expect(snapshot.jobs[0].status).toBe('running');
  expect(await rejection(s.createJob(crypto.randomUUID()))).toContain('RUN_ACTIVE');
  await s.finish(id, token, { ok: true, authJson: fakeAuth });
  expect((await s.snapshot()).authReady).toBe(true);
  expect((await s.snapshot()).active).toBeNull();
});

it('warmup priority preemption leaves manually requested usage jobs fenced', async () => {
  const s = await liveUsageObject();
  await s.setUsageAutoRefresh(true);
  const manual = (await s.createUsageJob(crypto.randomUUID())).job;
  await s.saveSchedule({ days: [0], time: '17:31', enabled: true });
  now += 100;
  await runDurableObjectAlarm(s);
  expect((await s.vmPoll(true, true)).jobId).toBe(manual.id);
  const snapshot = await s.snapshot();
  expect(snapshot.active.id).toBe(manual.id);
  expect(snapshot.jobs[0].status).toBe('dispatched');
});

it('frequent usage checks retain 100 warmups and only the latest 20 usage records', async () => {
  const s = object();
  const base = (await s.createJob(crypto.randomUUID())).job;
  const records = [];
  for (let i = 0; i < 100; i++) {
    records.push({
      ...base,
      id: crypto.randomUUID(),
      source: 'manual',
      status: 'succeeded',
      createdAt: now - 1_000_000 + i * 100,
    });
    records.push({
      ...base,
      id: crypto.randomUUID(),
      source: 'usage',
      status: 'succeeded',
      createdAt: now - 10_000 + i * 10,
    });
  }
  await runInDurableObject(s, (_instance, state) => {
    state.storage.sql.exec('DELETE FROM jobs');
    for (const record of records)
      state.storage.sql.exec(
        'INSERT INTO jobs VALUES (?, ?, ?)',
        record.id,
        JSON.stringify(record),
        record.createdAt,
      );
  });
  const snapshot = await s.snapshot();
  expect(snapshot.jobs).toHaveLength(120);
  expect(snapshot.jobs.filter((job) => job.source === 'manual')).toHaveLength(100);
  expect(snapshot.jobs.filter((job) => job.source === 'usage')).toHaveLength(20);
  expect(snapshot.jobs.some((job) => job.id === records[0].id)).toBe(true);
  expect(snapshot.jobs.some((job) => job.id === records[1].id)).toBe(false);
  expect(snapshot.jobs[0].id).toBe(records.at(-1).id);
  expect(
    await runInDurableObject(
      s,
      (_instance, state) =>
        state.storage.sql.exec('SELECT COUNT(*) AS count FROM jobs').one().count,
    ),
  ).toBe(120);
});

it.each([
  { label: 'due now', time: '17:35', expectedSource: 'scheduled' },
  { label: 'within runner safety horizon', time: '17:37', expectedSource: null },
  { label: 'beyond runner safety horizon', time: '17:39', expectedSource: 'usage' },
])('automatic limits prioritize a warmup $label', async ({ time, expectedSource }) => {
  const s = await liveUsageObject();
  await s.saveSchedule({ days: [0], time, enabled: true });
  await s.setUsageAutoRefresh(true);
  now += usageInterval;
  await s.vmPoll(true, true);
  await runDurableObjectAlarm(s);
  const snapshot = await s.snapshot();
  expect(snapshot.jobs).toHaveLength(expectedSource ? 1 : 0);
  if (expectedSource) expect(snapshot.jobs[0].source).toBe(expectedSource);
  expect(snapshot.usageAutoRefresh.nextAt).toBe(now + usageInterval);
});

it.each([
  { label: 'at', offset: 190_000, enabled: true, expectedJobs: 0 },
  { label: 'just beyond', offset: 190_001, enabled: true, expectedJobs: 1 },
  { label: 'disabled inside', offset: 1000, enabled: false, expectedJobs: 1 },
])(
  'automatic limits respect a warmup $label the precise safety boundary',
  async ({ offset, enabled, expectedJobs }) => {
    const s = await liveUsageObject();
    const rule = await s.saveSchedule({ days: [0], time: '17:38', enabled });
    const warmupAt = enabled ? now + usageInterval + offset : null;
    await runInDurableObject(s, (_instance, state) => {
      state.storage.sql.exec(
        'UPDATE schedules SET data = ? WHERE id = ?',
        JSON.stringify({ ...rule, nextAt: warmupAt }),
        rule.id,
      );
    });
    await s.setUsageAutoRefresh(true);
    now += usageInterval;
    await s.vmPoll(true, true);
    await runDurableObjectAlarm(s);
    const snapshot = await s.snapshot();
    expect(snapshot.jobs).toHaveLength(expectedJobs);
    if (expectedJobs) expect(snapshot.jobs[0].source).toBe('usage');
    expect(snapshot.nextAt).toBe(warmupAt);
  },
);

it('automatic limits HTTP setting requires session, CSRF and a boolean body', async () => {
  const s = await liveUsageObject(env.STATE.getByName('personal'));
  const path = '/api/usage/auto-refresh';
  const body = JSON.stringify({ enabled: true });
  expect(
    (await request(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }))
      .status,
  ).toBe(401);
  const session = await login();
  const headers = {
    Cookie: session.cookie,
    Origin: 'https://app.example',
    'Content-Type': 'application/json',
    'X-CSRF-Token': session.csrf,
  };
  expect(
    (await request(path, { method: 'PUT', headers: { ...headers, 'X-CSRF-Token': '' }, body }))
      .status,
  ).toBe(403);
  expect(
    (
      await request(path, {
        method: 'PUT',
        headers: { ...headers, Origin: 'https://evil.invalid' },
        body,
      })
    ).status,
  ).toBe(403);
  for (const invalid of ['{}', '{"enabled":"true"}', '{"enabled":1}', '{'])
    expect((await request(path, { method: 'PUT', headers, body: invalid })).status).toBe(400);
  expect((await s.snapshot()).usageAutoRefresh.enabled).toBe(false);
  expect((await request(path, { method: 'PUT', headers, body })).status).toBe(200);
  const nextAt = now + usageInterval;
  expect((await s.snapshot()).usageAutoRefresh.nextAt).toBe(nextAt);
  now += 1000;
  expect((await request(path, { method: 'PUT', headers, body })).status).toBe(200);
  expect((await s.snapshot()).usageAutoRefresh.nextAt).toBe(nextAt);
  expect((await request(path, { method: 'PUT', headers, body: '{"enabled":false}' })).status).toBe(
    200,
  );
  expect((await s.snapshot()).usageAutoRefresh.nextAt).toBeNull();
});

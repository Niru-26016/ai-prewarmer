/** Bound job runner; never reads the user's ordinary Codex home. */
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readLimits } from './limits.mjs';
import { readJson } from '../src/security.js';

export function classifyFailure(text, provider = 'codex') {
  // A final quota rejection may follow a successful refresh after an earlier 401.
  if (
    /usage[_ -]?limit|rate[_ -]?limit|quota[_ -](?:exceeded|exhausted)|insufficient_quota|\b429\b/i.test(
      text,
    )
  )
    return { ok: false, reconnect: false, error: 'RATE_LIMITED' };
  if (
    /refresh_token_reused|invalid_grant|refresh token.*(?:expired|revoked)|authentication required|please (?:log|sign) in|401 Unauthorized|token expired|credentials expired|invalid_api_key|invalid x-api-key|unauthorized/i.test(
      text,
    )
  ) {
    const reconnectErr =
      provider === 'claude'
        ? 'CLAUDE_RECONNECT_REQUIRED'
        : provider === 'antigravity'
          ? 'ANTIGRAVITY_RECONNECT_REQUIRED'
          : 'CODEX_RECONNECT_REQUIRED';
    return { ok: false, reconnect: true, error: reconnectErr };
  }
  return { ok: false, reconnect: false, error: 'EXECUTION_FAILED' };
}
export async function runCodex(home) {
  return new Promise((resolve) => {
    const env = { PATH: process.env.PATH, HOME: home, CODEX_HOME: home, LANG: 'C.UTF-8' };
    const child = spawn(
      'codex',
      [
        'exec',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '-c',
        'cli_auth_credentials_store="file"',
        'Reply with the single word OK.',
      ],
      { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' },
    );
    let stderr = '';
    let stdout = '',
      killed = false;
    child.stdout.on('data', (d) => {
      stdout = (stdout + d.toString()).slice(-4000);
    });
    child.stderr.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-8000);
    });
    const timer = setTimeout(() => {
      killed = true;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {}
    }, 120_000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, reconnect: false, error: 'EXECUTION_FAILED' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(
        code === 0 && !killed && /\bOK\b/.test(stdout)
          ? { ok: true, reconnect: false }
          : killed
            ? { ok: false, reconnect: false, error: 'EXECUTION_TIMEOUT' }
            : classifyFailure(`${stderr}\n${stdout}`, 'codex'),
      );
    });
  });
}
export async function runClaude(home, authJson = null) {
  return new Promise((resolve) => {
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      CLAUDE_CONFIG_DIR: home,
      LANG: 'C.UTF-8',
      ...(authJson?.apiKey ? { ANTHROPIC_API_KEY: authJson.apiKey } : {}),
      ...(authJson?.tokens?.access_token
        ? { ANTHROPIC_AUTH_TOKEN: authJson.tokens.access_token }
        : {}),
    };
    const child = spawn('claude', ['-p', 'Reply with the single word OK.'], {
      cwd: home,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stderr = '';
    let stdout = '',
      killed = false;
    child.stdout.on('data', (d) => {
      stdout = (stdout + d.toString()).slice(-4000);
    });
    child.stderr.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-8000);
    });
    const timer = setTimeout(() => {
      killed = true;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {}
    }, 120_000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, reconnect: false, error: 'EXECUTION_FAILED' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(
        code === 0 && !killed && /\bOK\b/.test(stdout)
          ? { ok: true, reconnect: false }
          : killed
            ? { ok: false, reconnect: false, error: 'EXECUTION_TIMEOUT' }
            : classifyFailure(`${stderr}\n${stdout}`, 'claude'),
      );
    });
  });
}
export async function runAntigravity(home, authJson = null) {
  return new Promise((resolve) => {
    const token =
      authJson?.oauthToken || authJson?.token?.access_token || authJson?.tokens?.access_token || '';
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      LANG: 'C.UTF-8',
      ...(authJson?.apiKey ? { GEMINI_API_KEY: authJson.apiKey } : {}),
      ...(token ? { AGY_TOKEN: token } : {}),
    };
    const child = spawn(
      'agy',
      ['--print', 'Reply with the single word OK.', '--dangerously-skip-permissions'],
      { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' },
    );
    let stderr = '';
    let stdout = '',
      killed = false;
    child.stdout.on('data', (d) => {
      stdout = (stdout + d.toString()).slice(-4000);
    });
    child.stderr.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-8000);
    });
    const timer = setTimeout(() => {
      killed = true;
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {}
    }, 120_000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ ok: false, reconnect: false, error: 'EXECUTION_FAILED' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(
        code === 0 && !killed && /\bOK\b/.test(stdout)
          ? { ok: true, reconnect: false }
          : killed
            ? { ok: false, reconnect: false, error: 'EXECUTION_TIMEOUT' }
            : classifyFailure(`${stderr}\n${stdout}`, 'antigravity'),
      );
    });
  });
}
function workerOrigin(env) {
  let url;
  try {
    url = new URL(env.WORKER_URL);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (env.RUNNER_TOKEN?.length ?? 0) < 32
  )
    return null;
  return url.origin;
}
export async function runRunner({
  env = process.env,
  fetcher = fetch,
  execute = null,
  query = readLimits,
} = {}) {
  const origin = workerOrigin(env);
  if (!origin || !/^[0-9a-f-]{36}$/i.test(env.JOB_ID ?? ''))
    return { ok: false, code: 'INVALID_CONFIG' };
  const claimToken = randomBytes(32).toString('hex'),
    jobId = env.JOB_ID;
  async function api(path, body) {
    const r = await fetcher(`${origin}/api/runner/${path}`, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${env.RUNNER_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, jobId, claimToken }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Error('RUNNER_API_FAILED');
    const data = await readJson(r);
    if (!data.ok) throw Error('RUNNER_API_FAILED');
    return data;
  }
  let home = null,
    claimed = false,
    authJson = null,
    provider = 'codex',
    result = { ok: false, reconnect: false };
  try {
    const claim = await api('claim', { allowLive: env.ALLOW_CODEX_EXECUTION === 'true' });
    claimed = true;
    provider = claim.provider || 'codex';
    if (claim.dryRun === true) result = { ok: true, reconnect: false };
    else if (env.ALLOW_CODEX_EXECUTION !== 'true') result = { ok: false, reconnect: false };
    else {
      home = await mkdtemp(join(tmpdir(), `${provider}-prewarm-`));
      await writeFile(join(home, 'auth.json'), JSON.stringify(claim.authJson), { mode: 0o600 });
      if (provider === 'claude') {
        await writeFile(join(home, '.claude.json'), JSON.stringify(claim.authJson), {
          mode: 0o600,
        });
      } else if (provider === 'antigravity') {
        await mkdir(join(home, '.gemini'), { recursive: true });
        await writeFile(
          join(home, '.gemini', 'jetski-standalone-oauth-token'),
          JSON.stringify(claim.authJson),
          { mode: 0o600 },
        );
      }
      try {
        if (claim.usageOnly) {
          result = await query(home);
        } else if (execute) {
          result = await execute(home);
        } else if (provider === 'claude') {
          result = await runClaude(home, claim.authJson);
        } else if (provider === 'antigravity') {
          result = await runAntigravity(home, claim.authJson);
        } else {
          result = await runCodex(home);
        }
      } finally {
        try {
          authJson = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8'));
        } catch {
          if (provider === 'codex') {
            result = { ok: false, reconnect: true };
          } else {
            authJson = claim.authJson;
          }
        }
      }
    }
  } catch (error) {
    // An exception is not evidence of expired credentials. Preserve the explicit
    // fail-closed result if the post-run credential file could not be recovered.
    const reconnectCode =
      provider === 'claude'
        ? 'CLAUDE_RECONNECT_REQUIRED'
        : provider === 'antigravity'
          ? 'ANTIGRAVITY_RECONNECT_REQUIRED'
          : 'CODEX_RECONNECT_REQUIRED';
    result = result.reconnect
      ? { ok: false, reconnect: true, error: reconnectCode }
      : classifyFailure(error instanceof Error ? error.message : '', provider);
  } finally {
    if (claimed) {
      let persisted = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await api('finish', { ...result, authJson });
          persisted = true;
          break;
        } catch {}
      }
      if (!persisted) result = { ok: false, reconnect: true };
    }
    if (home) await rm(home, { recursive: true, force: true });
  }
  return { ok: result.ok, code: result.ok ? 'COMPLETED' : 'FAILED_REQUIRES_REVIEW' };
}
export async function pollVm({ env = process.env, fetcher = fetch, runner = runRunner } = {}) {
  const origin = workerOrigin(env);
  if (!origin) return { ok: false, code: 'INVALID_CONFIG' };
  try {
    const response = await fetcher(origin + '/api/runner/vm-poll', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${env.RUNNER_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        allowLive: env.ALLOW_CODEX_EXECUTION === 'true',
        supportsUsage: true,
      }),
    });
    if (!response.ok)
      return {
        ok: false,
        code: response.status === 403 ? 'VM_RUNNER_DISABLED' : 'POLL_FAILED',
      };
    const data = await readJson(response);
    if (data.ok !== true) return { ok: false, code: 'POLL_FAILED' };
    if (data.jobId === null) return { ok: true, code: 'IDLE' };
    if (!/^[0-9a-f-]{36}$/i.test(data.jobId ?? '')) return { ok: false, code: 'POLL_FAILED' };
    return await runner({ env: { ...env, JOB_ID: data.jobId }, fetcher });
  } catch {
    return { ok: false, code: 'POLL_FAILED' };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runRunner();
  console.log(JSON.stringify({ event: 'runner_finished', code: result.code }));
  process.exitCode = result.ok ? 0 : 1;
}

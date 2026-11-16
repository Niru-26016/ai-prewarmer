import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeLimits } from '../src/limits.js';
import { classifyFailure, runRunner } from '../scripts/runner.mjs';
import { validateAuthJson } from '../src/security.js';
test('quota snapshots retain only valid public window fields', () => {
  const w = {
    usedPercent: 24,
    windowDurationMins: 300,
    resetsAt: 1900000000,
    secret: 'never-store',
  };
  assert.deepEqual(sanitizeLimits({ rateLimits: { primary: w, accountId: 'private' } }), [
    {
      id: 'codex',
      primary: { usedPercent: 24, windowDurationMins: 300, resetsAt: 1900000000 },
      secondary: null,
    },
  ]);
  assert.deepEqual(sanitizeLimits({ rateLimits: { primary: { ...w, usedPercent: 101 } } }), []);
});
test('rate, network and timeout errors do not masquerade as expired auth', () => {
  for (const message of [
    '429 usage limit reached',
    'usage_limit_reached',
    'usageLimitExceeded',
    'rate_limit_exceeded',
    'Earlier 401 Unauthorized; session refreshed; usage_limit_reached',
    'Earlier 401 Unauthorized; session refreshed; usageLimitExceeded',
  ]) {
    assert.deepEqual(classifyFailure(message), {
      ok: false,
      reconnect: false,
      error: 'RATE_LIMITED',
    });
  }
  assert.equal(classifyFailure('network connection reset').reconnect, false);
  assert.equal(classifyFailure('refresh_token_reused').reconnect, true);
  assert.equal(classifyFailure('invalid_grant').reconnect, true);
});
test('usage job calls only read-only query and persists refreshed auth', async () => {
  let queried = false,
    finish;
  await runRunner({
    env: {
      WORKER_URL: 'https://example.invalid',
      RUNNER_TOKEN: 'r'.repeat(48),
      JOB_ID: '0e672bd9-55b5-44d9-84e5-8f609ef50ce1',
      ALLOW_CODEX_EXECUTION: 'true',
    },
    fetcher: async (url, opts) => {
      if (url.endsWith('claim'))
        return Response.json({
          ok: true,
          dryRun: false,
          usageOnly: true,
          authJson: { auth_mode: 'chatgpt', tokens: { refresh_token: 'fake' } },
        });
      finish = JSON.parse(opts.body);
      return Response.json({ ok: true });
    },
    execute: () => {
      throw Error('No model request allowed');
    },
    query: async () => {
      queried = true;
      return { ok: true, reconnect: false, limits: [] };
    },
  });
  assert.equal(queried, true);
  assert.equal(finish.authJson.tokens.refresh_token, 'fake');
});
test('multi-provider failure classification', () => {
  assert.deepEqual(classifyFailure('token expired', 'claude'), {
    ok: false,
    reconnect: true,
    error: 'CLAUDE_RECONNECT_REQUIRED',
  });
  assert.deepEqual(classifyFailure('credentials expired', 'antigravity'), {
    ok: false,
    reconnect: true,
    error: 'ANTIGRAVITY_RECONNECT_REQUIRED',
  });
  assert.deepEqual(classifyFailure('invalid_grant', 'codex'), {
    ok: false,
    reconnect: true,
    error: 'CODEX_RECONNECT_REQUIRED',
  });
});
test('multi-provider auth json validation', () => {
  assert.throws(() => validateAuthJson({ auth_mode: 'claude' }, 'claude'));
  assert.ok(validateAuthJson({ auth_mode: 'claude', apiKey: 'sk-ant-test' }, 'claude'));
  assert.throws(() => validateAuthJson({ auth_mode: 'antigravity' }, 'antigravity'));
  assert.ok(validateAuthJson({ auth_mode: 'antigravity', oauthToken: 'ya29.test' }, 'antigravity'));
});

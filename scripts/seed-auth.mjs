/** Trusted local-only credential upload. Do not run this in public CI. */
import { readFile } from 'node:fs/promises';
import { secretPrompt } from './secret-prompt.mjs';
const rawArgs = process.argv.slice(2);
let providerArg = 'codex';
const args = [];
for (const arg of rawArgs) {
  if (arg.startsWith('--provider=')) {
    providerArg = arg.split('=')[1].toLowerCase();
  } else {
    args.push(arg);
  }
}
if (!['codex', 'claude', 'antigravity'].includes(providerArg)) {
  throw Error('Provider must be one of: codex, claude, antigravity');
}
const [urlArg, fileArg, approval] = args;
if (approval !== '--allow-credential-upload')
  throw Error(
    'Credential upload is disabled. Review the destination, then explicitly add --allow-credential-upload.',
  );
if (!urlArg || !fileArg) {
  console.error(
    'Usage: node scripts/seed-auth.mjs https://your-worker.workers.dev /path/to/dedicated/auth.json --allow-credential-upload [--provider=codex|claude|antigravity]',
  );
  process.exit(2);
}
const base = urlArg.replace(/\/$/, '');
const destination = new URL(base);
if (
  destination.protocol !== 'https:' ||
  destination.username ||
  destination.password ||
  destination.pathname !== '/' ||
  destination.search ||
  destination.hash
)
  throw Error('Use a plain HTTPS origin for credential upload.');
const password = process.env.PREWARM_ADMIN_PASSWORD || (await secretPrompt());
const origin = new URL(base).origin;
const login = await fetch(`${base}/api/login`, {
  method: 'POST',
  redirect: 'error',
  signal: AbortSignal.timeout(15000),
  headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ password }),
});
if (!login.ok) throw Error('Dashboard login failed.');
const session = await login.json();
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw Error('No session cookie returned.');
const status = await fetch(`${base}/api/status`, {
  headers: { Cookie: cookie },
  redirect: 'error',
  signal: AbortSignal.timeout(15000),
});
if (!status.ok || !(await status.json()).connectionAllowed)
  throw Error('This deployment has locked Codex connections. No auth file was read.');
const auth = JSON.parse(await readFile(fileArg, 'utf8'));
if (providerArg === 'codex') {
  if (auth.auth_mode !== 'chatgpt' || !auth.tokens?.refresh_token)
    throw Error('Not file-backed ChatGPT authentication.');
} else if (providerArg === 'claude') {
  if (!auth.auth_mode) auth.auth_mode = 'claude';
  if (auth.auth_mode !== 'claude' || (!auth.sessionKey && !auth.apiKey && !auth.tokens))
    throw Error('Not valid Claude authentication.');
} else if (providerArg === 'antigravity') {
  if (!auth.auth_mode) auth.auth_mode = 'antigravity';
  if (auth.token && !auth.tokens) auth.tokens = auth.token;
  if (auth.auth_mode !== 'antigravity' || (!auth.oauthToken && !auth.apiKey && !auth.tokens))
    throw Error('Not valid Antigravity authentication.');
}
const seeded = await fetch(`${base}/api/auth/seed?provider=${providerArg}`, {
  method: 'POST',
  redirect: 'error',
  signal: AbortSignal.timeout(15000),
  headers: {
    Origin: origin,
    Cookie: cookie,
    'X-CSRF-Token': session.csrf,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(auth),
});
if (!seeded.ok) throw Error(`Credential upload failed (${seeded.status}).`);
await fetch(`${base}/api/logout`, {
  method: 'POST',
  redirect: 'error',
  headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': session.csrf },
  signal: AbortSignal.timeout(15000),
});
console.log(
  `${providerArg} authentication uploaded over HTTPS and encrypted at rest. No credentials were printed.`,
);

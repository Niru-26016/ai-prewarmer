# AI Prewarmer

> Multi-provider AI quota prewarmer & automation scheduler for OpenAI Codex, Claude Code, and Google Antigravity.

AI Prewarmer is an open-source, mobile-installable Progressive Web App (PWA) with a Cloudflare Worker & SQLite Durable Object backend. It runs automated, serialized warmup triggers on custom schedules to ensure your AI CLI coding sessions and quota windows are active and ready when your workday begins.

---

## Features

- **Multi-Provider Control**: Dedicated tabs, live quota tracking, and independent warmups for **OpenAI Codex**, **Anthropic Claude Code**, and **Google Antigravity**.
- **Automated Alarms**: Configure up to 24 weekly schedule slots in IST (Asia/Kolkata) or your preferred timezone.
- **One-Tap Dispatch**: Trigger manual warmups on demand with built-in idempotency and deduplication.
- **Mobile-Ready PWA**: Fully responsive, dark-mode control center that installs on Android/iOS home screens with offline shell caching.
- **Enterprise-Grade Security**:
  - Credentials encrypted at rest using AES-256-GCM with a distinct encryption key.
  - Rate-limited authentication with `SameSite=Strict`, `HttpOnly` cookies and per-session CSRF tokens.
  - Zero raw tokens exposed over the browser API or stored unencrypted on disk.
- **Isolated Runner Daemon**:
  - Minimal background runner for any Linux VM, VPS, or container.
  - Sandboxed via systemd (read-only filesystem, private `/tmp`, CPU quotas, memory limits).
  - Single-use claim tokens with automatic credential write-back and quarantine on failure.
- **Zero Cloud Cost**: Designed to fit comfortably within the Cloudflare Workers free plan.

---

## Architecture

```text
 ┌──────────────────────┐        HTTPS / CSRF
 │  Mobile / Desktop    │ ────────────────────────┐
 │   React 19 PWA       │                         │
 └──────────────────────┘                         ▼
                                       ┌──────────────────────┐
                                       │  Cloudflare Worker   │
                                       │   Durable Object     │
                                       │ (SQLite State Engine)│
                                       └──────────────────────┘
                                                  ▲
 ┌──────────────────────┐       Poll & Claim      │
 │ Isolated VM Runner   │ ────────────────────────┘
 │ systemd Daemon       │ (Single-use claimToken,
 │ (Node.js + CLI tools)│  AES-256-GCM write-back)
 └──────────────────────┘
```

1. **Client (PWA)**: React 19 single-page app serving the control center, live allowance graphs, and schedule manager.
2. **Backend (Cloudflare Worker)**: A Durable Object running transactional SQLite to manage schedules, execution history, auth fencing, and runner leases.
3. **Runner (Host Daemon)**: A lightweight daemon that polls for queued jobs, acquires a single-use lease, executes an isolated CLI invocation in a temporary directory, and safely writes back refreshed tokens.

---

## Quickstart (Local Development)

### 1. Requirements

- **Node.js**: `22.x` (see `.nvmrc`)
- **npm**: `10.x` or later

### 2. Setup & Run

```bash
# Clone the repository
git clone https://github.com/your-username/ai-prewarmer.git
cd ai-prewarmer

# Install pinned dependencies
npm ci

# Generate local development secrets in .dev.vars
npm run local:setup

# Start local server with hot reloading
npm start
```

Open `http://127.0.0.1:8787` in your browser. Inspect the auto-generated `.dev.vars` file for your `ADMIN_PASSWORD` to sign in.

In local mode:

- The backend runs on a local `workerd` instance with an embedded SQLite database.
- Executions run in mock mode (`DRY_RUN=true`, `EXECUTOR=mock`), letting you test schedules and UI flows without external API calls or real credentials.

---

## Production Deployment

### 1. Cloudflare Worker Setup

1. Configure your deployment targets in `wrangler.jsonc`.
2. Generate secure random secrets:
   ```bash
   ADMIN_PASSWORD=$(openssl rand -hex 24)
   SESSION_SECRET=$(openssl rand -hex 32)
   RUNNER_TOKEN=$(openssl rand -hex 32)
   AUTH_ENCRYPTION_KEY=$(openssl rand -base64 32)
   ```
3. Set the secrets on your Cloudflare Worker:
   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put RUNNER_TOKEN
   npx wrangler secret put AUTH_ENCRYPTION_KEY
   ```
4. Deploy the Worker and client assets:
   ```bash
   npm run build
   npx wrangler deploy --env production
   ```

### 2. VM / VPS Runner Setup

The runner can run on any small Linux instance (e.g. Ubuntu 22.04+ on AWS, Oracle Cloud, Hetzner, or DigitalOcean):

1. Package the runner bundle:
   ```bash
   python3 scripts/package-vm-runner.py
   ```
2. On your server, configure `/etc/codex-prewarmer/runner.json` (mode `0600`):
   ```json
   {
     "WORKER_URL": "https://your-worker.your-subdomain.workers.dev",
     "RUNNER_TOKEN": "<your-64-char-runner-token>",
     "ALLOW_CODEX_EXECUTION": true
   }
   ```
3. Install the systemd service:
   ```bash
   sudo python3 infra/install-vm-runner.py <release-name> <sha256>
   ```
4. Verify the runner status:
   ```bash
   sudo systemctl status codex-prewarmer.service
   sudo journalctl -u codex-prewarmer.service -f
   ```

---

## Linking CLI Accounts

Once your dashboard is live, link your preferred provider sessions from your trusted workstation:

### OpenAI Codex

```bash
mkdir -p .build/codex-connection && chmod 700 .build/codex-connection
CODEX_HOME="$PWD/.build/codex-connection" codex -c 'cli_auth_credentials_store="file"' login
node scripts/seed-auth.mjs https://your-worker.workers.dev .build/codex-connection/auth.json --allow-credential-upload --provider=codex
```

### Anthropic Claude Code

```bash
claude login
node scripts/seed-auth.mjs https://your-worker.workers.dev ~/.claude.json --allow-credential-upload --provider=claude
```

### Google Antigravity

```bash
agy --print "OK" --dangerously-skip-permissions
node scripts/seed-auth.mjs https://your-worker.workers.dev ~/.gemini/antigravity/auth.json --allow-credential-upload --provider=antigravity
```

The `seed-auth.mjs` utility prompts privately for your dashboard password, validates server connectivity over HTTPS, encrypts your payload at rest, and never logs credentials.

---

## Testing & Quality Assurance

This repository maintains strict quality standards with automated tests covering every layer:

```bash
# Full verification suite (lint, format check, TypeScript, unit tests, worker tests, build)
npm run check

# Format all source files with Prettier
npm run format

# Run local unit tests (Node test runner)
npm run test:unit

# Run Cloudflare Worker integration tests (Vitest with workerd pool)
npm run test:worker

# Run Playwright E2E browser tests (Desktop & Android viewports)
npm run test:e2e
```

---

## Security & Privacy

- **Single-Tenant Model**: Designed for individual developers. The Durable Object coordinates state exclusively for the deployment owner.
- **No Plaintext Tokens**: Credentials are only ever decrypted in volatile memory inside a short-lived execution lease.
- **Quarantine on Disconnect**: If an external provider error indicates credential invalidation or a network partition, the session is quarantined until re-authenticated.
- **Zero Telemetry**: No third-party trackers, analytics, or external logging scripts are included.

For details on security boundaries and failure modes, see [docs/SECURITY.md](docs/SECURITY.md).

---

## Contributing

We welcome contributions! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code style, test requirements, and pull request process.

---

## License

This project is licensed under the [MIT License](LICENSE).

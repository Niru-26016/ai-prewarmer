# System Architecture

AI Prewarmer coordinates scheduled warmup tasks across multiple AI coding CLIs (OpenAI Codex, Claude Code, and Google Antigravity).

## Component Overview

```text
 ┌────────────────────────────────────────────────────────┐
 │                      Client Layer                      │
 │    React 19 PWA · Service Worker · Web Manifest        │
 └──────────────────────────┬─────────────────────────────┘
                            │ HTTPS / Session Cookie / CSRF
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │                     Edge Backend                       │
 │ Cloudflare Worker · SQLite-backed Durable Object       │
 │   - Schedule calculation (IST / Asia-Kolkata)          │
 │   - Single-use lease coordinator                       │
 │   - AES-256-GCM credential vault                      │
 │   - Rate-limited auth & CSRF validation                │
 └──────────────────────────┬─────────────────────────────┘
                            │ Poll & Lease Protocol
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │                    Execution Layer                     │
 │          Isolated Linux Host (VM / VPS)                │
 │   - Polling daemon with machine bearer token           │
 │   - Sandboxed systemd execution unit                   │
 │   - Short-lived ephemeral credential directory         │
 │   - Single-use token callback & credential refresh     │
 └────────────────────────────────────────────────────────┘
```

## State Machine & Execution Lifecycle

1. **Scheduling**:
   - Up to 24 weekly schedule slots are stored in SQLite inside the Durable Object.
   - Schedules use `Asia/Kolkata` (IST, UTC+05:30) to compute exact trigger timestamps.
   - Cloudflare Durable Object alarms fire at the next earliest deadline.

2. **Job Queuing & Deduplication**:
   - When an alarm fires or a user triggers **Run Now**, an execution job is created with a unique `jobId`.
   - Idempotency keys prevent concurrent duplicate jobs for the same trigger slot.

3. **Lease Claim**:
   - The VM daemon polls `POST /api/runner/vm-poll` using a dedicated bearer token (`RUNNER_TOKEN`).
   - If a job is pending, the runner calls `POST /api/runner/claim` with a randomly generated 64-character `claimToken`.
   - The Durable Object validates that the job is currently queued, leases it exclusively to the caller, and returns the encrypted credentials.

4. **Isolated Execution**:
   - The daemon unpacks credentials into an ephemeral, temporary `mode 0700` working directory.
   - The target CLI (Codex, Claude, or Antigravity) is executed under a restricted sub-process.
   - Output tokens and execution logs are scrubbed; no plaintext tokens are logged.

5. **Atomic Callback & Refresh**:
   - The runner posts results back to `POST /api/runner/finish` using the original `claimToken`.
   - If the provider refreshed the session token during the execution, the updated token is re-encrypted with AES-256-GCM and written back atomically.
   - If execution failed with an authentication invalidation, the credential is marked as `quarantined` to prevent cascading failures until re-authenticated.

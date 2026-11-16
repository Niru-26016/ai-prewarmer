# Linux VM / VPS Runner Guide

The AI Prewarmer runner is a lightweight, serialized Node.js daemon designed to run on any Linux virtual machine (Ubuntu 22.04 LTS or Debian 12 recommended) to execute warmups on schedule.

## Security Architecture

The runner is isolated with defense-in-depth measures:

- **Dedicated Service User**: Runs under an unprivileged user created dynamically by systemd.
- **Filesystem Isolation**: Runs with a strictly read-only root filesystem view, a private `/tmp` directory, and hidden `/home` directories.
- **Resource Limits**: Configured with strict resident memory limits (`256M`), swap limits (`512M`), and CPU quotas to avoid starvation on small instances.
- **Ephemeral Credentials**: For each claimed warmup, credentials are written into a temporary `mode 0700` directory, used for execution, and immediately wiped upon completion.
- **No Plaintext Tokens on Disk**: Tokens are only ever decrypted in volatile memory during the active execution lease.

---

## Prerequisites

- A Linux VPS or VM (AWS EC2, Oracle Cloud Free Tier, Hetzner, DigitalOcean, etc.).
- Python 3.8+ on your workstation to package the release payload.
- Systemd 249 or newer on the target host.

---

## Deployment Steps

### 1. Build the Release Bundle

On your development machine:

```bash
python3 scripts/package-vm-runner.py
```

This verifies the pinned runtime binaries, builds the payload, and produces:

- `.build/vm-packages/vm-TIMESTAMP.tgz`
- A corresponding SHA-256 checksum manifest.

### 2. Copy the Bundle to Your Server

```bash
ssh user@your-server-ip "mkdir -p ~/prewarmer-staging"
scp .build/vm-packages/vm-*.tgz user@your-server-ip:~/prewarmer-staging/
```

### 3. Configure the Runner

On your server, create `/etc/codex-prewarmer/runner.json` with permissions `0600`:

```json
{
  "WORKER_URL": "https://your-worker.your-subdomain.workers.dev",
  "RUNNER_TOKEN": "<your-64-char-runner-token>",
  "ALLOW_CODEX_EXECUTION": true
}
```

### 4. Install the Systemd Service

Run the installer as root:

```bash
sudo python3 infra/install-vm-runner.py <release-name> <release-sha256>
```

The installer verifies the archive checksum, links `/opt/codex-prewarmer/current`, installs `/etc/systemd/system/codex-prewarmer.service`, and starts the service.

---

## Operational Commands

Check runner status and recent execution logs:

```bash
sudo systemctl status codex-prewarmer.service
sudo journalctl -u codex-prewarmer.service -n 50 -f
```

Inspect resource consumption:

```bash
sudo systemctl show codex-prewarmer.service -p MemoryCurrent -p MemoryPeak -p CPUQuotaPerSecUSec
```

Graceful maintenance (drain running jobs before stopping):

```bash
sudo systemctl kill --kill-who=main --signal=SIGTERM codex-prewarmer.service
sudo systemctl stop codex-prewarmer.service
```

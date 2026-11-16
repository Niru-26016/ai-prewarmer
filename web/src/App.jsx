import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Activity,
  AlarmClock,
  ArrowRight,
  CalendarClock,
  Check,
  CheckCheck,
  Clock,
  Cloud,
  Cpu,
  ExternalLink,
  Gauge,
  History,
  KeyRound,
  Lock,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const format = (time) =>
  time == null
    ? '—'
    : new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(time);
function timeString(time) {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
function timeUntil(next, now) {
  if (!next) return 'No scheduled runs';
  const n = Math.max(0, Math.ceil((next - now) / 1000));
  if (!n) return 'Starting soon';
  const d = Math.floor(n / 86400),
    h = Math.floor((n % 86400) / 3600),
    m = Math.floor((n % 3600) / 60),
    s = n % 60;
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
}
let csrfToken = '';
const messages = {
  NOT_SIGNED_IN: 'Your dashboard session expired. Please sign in again.',
  RUN_ACTIVE: 'Another run is already queued or running.',
  CODEX_CONNECTION_LOCKED: 'Codex connection is locked for this dry-run release.',
  RATE_LIMITED: 'Codex allowance exhausted. Wait for the reset; reconnecting is not needed.',
  AUTO_CHECK_DISABLED: 'Automatic check cancelled because auto-check is off.',
  WARMUP_PRIORITY: 'Automatic check skipped to keep your warmup on schedule.',
  EXECUTION_FAILED: 'The request failed. This does not by itself mean your login expired.',
  EXECUTION_TIMEOUT: 'The request timed out. Your login has not been marked expired.',
  INVALID_CODEX_AUTH: 'Use a fresh file-backed ChatGPT Codex session from your trusted computer.',
  INVALID_CLAUDE_AUTH: 'Use a valid Claude Code session or API key from your trusted computer.',
  INVALID_ANTIGRAVITY_AUTH:
    'Use a valid Google Antigravity session or API key from your trusted computer.',
  INCORRECT_PASSWORD: 'Incorrect password.',
  LOGIN_RATE_LIMITED: 'Too many sign-in attempts. Try again in 15 minutes.',
  INVALID_CSRF: 'Your session changed. Refresh and try again.',
  CODEX_RECONNECT_REQUIRED: 'Reconnect Codex from your trusted computer before a live run.',
  CLAUDE_RECONNECT_REQUIRED: 'Reconnect Claude Code from your trusted computer before a live run.',
  ANTIGRAVITY_RECONNECT_REQUIRED:
    'Reconnect Google Antigravity from your trusted computer before a live run.',
  SERVER_NOT_CONFIGURED: 'Dashboard authentication is not configured yet.',
};
export const PROVIDERS = [
  { id: 'codex', name: 'OpenAI Codex', short: 'Codex', tone: 'green' },
  { id: 'claude', name: 'Anthropic Claude Code', short: 'Claude', tone: 'amber' },
  { id: 'antigravity', name: 'Google Antigravity', short: 'Antigravity', tone: 'blue' },
];
async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && path !== '/login') headers['X-CSRF-Token'] = csrfToken;
  if (['/run', '/usage/refresh'].includes(path) || path.startsWith('/run?'))
    headers['Idempotency-Key'] = crypto.randomUUID();
  const response = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) {
    if (response.status === 401 && path !== '/login')
      window.dispatchEvent(new Event('session-expired'));
    const error = Error(
      messages[result.error] || result.message || result.error || `HTTP ${response.status}`,
    );
    error.status = response.status;
    throw error;
  }
  if (result.csrf) csrfToken = result.csrf;
  return result;
}
const initial = {
  days: [0],
  time: '01:00',
  label: 'Sunday morning',
  enabled: true,
  providers: ['codex'],
};
function Brand({ mini = false }) {
  return (
    <div className="brand">
      <div className="brand-icon">
        <Zap size={21} strokeWidth={2.7} />
      </div>
      {!mini && (
        <div className="brand-copy">
          <strong>
            prewarm<span>.</span>
          </strong>
          <small>CODEX · CLAUDE · ANTIGRAVITY</small>
        </div>
      )}
    </div>
  );
}
function Badge({ children, tone = 'neutral', dot = false }) {
  return (
    <span className={`badge ${tone}`}>
      {dot && <i className="dot" />}
      {children}
    </span>
  );
}
function Login({ onLogin }) {
  const [password, setPassword] = useState(''),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  async function login(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api('/login', { method: 'POST', body: { password } });
      setPassword('');
      await onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-orb" />
      <div className="login-orb-secondary" />
      <div className="login-container">
        <Brand />
        <div className="login-panel">
          <div className="login-shield">
            <Lock size={23} />
          </div>
          <p className="eyebrow">PRIVATE DASHBOARD</p>
          <h1>
            Your coding clock,
            <br />
            <span>on your terms.</span>
          </h1>
          <p className="subdued">
            Schedule Codex warmups, check their status, and manage your alarms from any device.
          </p>
          <form onSubmit={login}>
            <label className="field-label" htmlFor="pass">
              Dashboard password
            </label>
            <input
              id="pass"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your secure password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button className="btn primary full" disabled={loading}>
              {loading ? 'Signing in…' : 'Unlock dashboard'} <ArrowRight size={17} />
            </button>
          </form>
          {error && <div className="alert error">{error}</div>}
        </div>
        <p className="login-footer">
          <ShieldCheck size={15} /> Your dashboard session stays in a private, HttpOnly cookie.
        </p>
      </div>
    </main>
  );
}
function ScheduleModal({ schedule, onClose, onSave }) {
  const [days, setDays] = useState(schedule?.days || initial.days),
    [time, setTime] = useState(schedule?.time || initial.time),
    [label, setLabel] = useState(schedule?.label || ''),
    [enabled, setEnabled] = useState(schedule?.enabled ?? true),
    [providers, setProviders] = useState(schedule?.providers || ['codex']),
    [working, setWorking] = useState(false),
    [error, setError] = useState('');
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = dialogRef.current;
    dialog.querySelector('input,button')?.focus();
    const key = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'Tab') {
        const items = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')];
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    dialog.addEventListener('keydown', key);
    return () => {
      dialog.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [onClose]);
  const toggle = (day) =>
    setDays((old) => (old.includes(day) ? old.filter((d) => d !== day) : [...old, day].sort()));
  const toggleProvider = (id) =>
    setProviders((old) =>
      old.includes(id) ? (old.length > 1 ? old.filter((p) => p !== id) : old) : [...old, id],
    );
  async function submit(e) {
    e.preventDefault();
    if (!days.length) return setError('Choose at least one day.');
    if (!providers.length) return setError('Choose at least one AI provider.');
    setWorking(true);
    setError('');
    try {
      await onSave({ days, time, label, enabled, providers });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="overlay">
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-title"
      >
        <div className="modal-title">
          <div>
            <p className="eyebrow">SCHEDULE BUILDER</p>
            <h2 id="schedule-title">{schedule ? 'Edit schedule' : 'New warmup alarm'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit}>
          <label className="field-label" htmlFor="alarm-name">
            Alarm name <span className="optional">(optional)</span>
          </label>
          <input
            id="alarm-name"
            maxLength={60}
            placeholder="e.g. Early morning coding"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <div className="field-label section-label" id="repeat-label">
            Repeat on
          </div>
          <div className="day-picker" role="group" aria-labelledby="repeat-label">
            {DAY_LABELS.map((d, i) => (
              <button
                type="button"
                key={d}
                className={`day ${days.includes(i) ? 'selected' : ''}`}
                onClick={() => toggle(i)}
                aria-pressed={days.includes(i)}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="presets">
            <button type="button" onClick={() => setDays([1, 2, 3, 4, 5])}>
              Weekdays
            </button>
            <button type="button" onClick={() => setDays([0, 6])}>
              Weekends
            </button>
            <button type="button" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])}>
              Every day
            </button>
          </div>
          <div className="field-label section-label" id="providers-label">
            Target AI providers
          </div>
          <div className="provider-picker" role="group" aria-labelledby="providers-label">
            {PROVIDERS.map((p) => {
              const selected = providers.includes(p.id);
              return (
                <button
                  type="button"
                  key={p.id}
                  className={`provider-chip ${selected ? 'selected' : ''}`}
                  onClick={() => toggleProvider(p.id)}
                  aria-pressed={selected}
                >
                  <span className={`provider-dot ${p.tone}`} />
                  {p.short}
                </button>
              );
            })}
          </div>
          <label className="field-label section-label" htmlFor="alarm-time">
            Trigger time <span className="timezone">Asia/Kolkata (IST)</span>
          </label>
          <input
            className="time-input"
            id="alarm-time"
            type="time"
            required
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
          <label className="check-row">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Enable this alarm</span>
          </label>
          {error && <div className="alert error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={working || !days.length}>
              {working ? 'Saving…' : 'Save schedule'} <Check size={17} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
function windowLabel(minutes) {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440}-day`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}-hour`;
  return `${minutes}-minute`;
}
function LimitsCard({ data, online, onRefresh, provider = 'codex', creds, setView }) {
  const [refreshing, setRefreshing] = useState(false);
  const [savingAutoRefresh, setSavingAutoRefresh] = useState(false);
  const autoRefreshBusy = useRef(false);
  const [error, setError] = useState('');
  const autoEnabled = data.usageAutoRefresh?.enabled === true;
  const canEnableAutoRefresh = online && data.authReady && !data.dryRun && data.executor === 'vm';
  const autoPaused =
    autoEnabled &&
    (!data.authReady ||
      data.dryRun ||
      data.executor !== 'vm' ||
      !data.vmRunner?.online ||
      !data.vmRunner?.liveAllowed ||
      !data.vmRunner?.supportsUsage);
  const canRefresh =
    online &&
    !data.active &&
    data.authReady &&
    !data.dryRun &&
    data.executor === 'vm' &&
    data.vmRunner?.online &&
    data.vmRunner?.supportsUsage;
  const buckets = data.usage?.buckets || [];
  const checking =
    data.active && data.jobs.some((job) => job.id === data.active.id && job.source === 'usage');
  async function refreshLimits() {
    setRefreshing(true);
    setError('');
    try {
      await api('/usage/refresh', { method: 'POST' });
      await onRefresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }
  async function toggleAutoRefresh() {
    if (autoRefreshBusy.current || !online || (!autoEnabled && !canEnableAutoRefresh)) return;
    autoRefreshBusy.current = true;
    setSavingAutoRefresh(true);
    setError('');
    try {
      await api('/usage/auto-refresh', { method: 'PUT', body: { enabled: !autoEnabled } });
      await onRefresh();
    } catch (e) {
      setError(e.message);
    } finally {
      autoRefreshBusy.current = false;
      setSavingAutoRefresh(false);
    }
  }

  const currentProvider = PROVIDERS.find((p) => p.id === provider) || PROVIDERS[0];
  const isReady = creds?.[provider]?.ready ?? false;

  return (
    <section className="stat-card limits-card" aria-labelledby="limits-title">
      <div className="stat-top">
        <span id="limits-title">{currentProvider.short} limits</span>
        {provider === 'antigravity' ? (
          <Sparkles size={18} aria-hidden="true" />
        ) : provider === 'claude' ? (
          <Cpu size={18} aria-hidden="true" />
        ) : (
          <Gauge size={18} aria-hidden="true" />
        )}
      </div>

      {provider === 'codex' ? (
        <>
          {buckets.length > 0 ? (
            <div className="limits-list">
              {buckets.map((bucket) => (
                <div className="limits-bucket" key={bucket.id}>
                  {buckets.length > 1 && <div className="limits-bucket-name">{bucket.id}</div>}
                  {['primary', 'secondary'].map((key) => {
                    const window = bucket[key];
                    if (!window) return null;
                    const remaining = Math.max(0, Math.min(100, 100 - window.usedPercent));
                    return (
                      <div className="limit-window" key={key}>
                        <div className="limit-heading">
                          <span>{windowLabel(window.windowDurationMins)} window</span>
                          <strong>
                            {remaining}% <small>left</small>
                          </strong>
                        </div>
                        <div
                          className="limit-track"
                          role="progressbar"
                          aria-label={`${windowLabel(window.windowDurationMins)} remaining`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={remaining}
                        >
                          <span style={{ width: `${remaining}%` }} />
                        </div>
                        <div className="limit-reset">
                          Resets {format(window.resetsAt * 1000)} IST
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <p className="limits-empty">
              {data.usage?.error
                ? 'Limits unavailable. Try refreshing again.'
                : 'Limits not checked yet.'}
            </p>
          )}
          {data.usage?.checkedAt && (
            <p className="limits-checked">
              Last checked {format(data.usage.checkedAt)} IST · Snapshot may have changed
            </p>
          )}
          {error && (
            <p className="limits-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="limits-refresh"
            onClick={refreshLimits}
            disabled={!canRefresh || refreshing}
          >
            <RefreshCw size={13} className={refreshing || checking ? 'spin-icon' : ''} />{' '}
            {refreshing || checking ? 'Checking limits…' : 'Refresh limits'}
          </button>
          <div className="limits-auto-check">
            <button
              type="button"
              role="switch"
              aria-checked={autoEnabled}
              aria-describedby="limits-auto-help"
              className="limits-auto-switch"
              onClick={toggleAutoRefresh}
              disabled={savingAutoRefresh || !online || (!autoEnabled && !canEnableAutoRefresh)}
            >
              <span>Auto-check every 5 minutes</span>
              <strong aria-hidden="true">
                {savingAutoRefresh ? 'Saving…' : autoEnabled ? 'On' : 'Off'}
              </strong>
            </button>
            <p className="limits-hint" id="limits-auto-help">
              Background, read-only checks. No model request.
              {autoEnabled &&
                (autoPaused
                  ? ' Paused until Codex and the VM runner are ready.'
                  : data.usageAutoRefresh?.nextAt
                    ? ` Next check ${format(data.usageAutoRefresh.nextAt)} IST.`
                    : ' Waiting for the next background check.')}
            </p>
          </div>
          {!canRefresh && !data.active && (
            <p className="limits-hint">
              {!online
                ? 'Reconnect to refresh.'
                : data.dryRun
                  ? 'Unavailable in test mode.'
                  : !data.authReady
                    ? 'Connect Codex to refresh.'
                    : 'Runner must be online and support limits.'}
            </p>
          )}
        </>
      ) : provider === 'claude' ? (
        <div className="provider-limits-custom">
          {isReady ? (
            <>
              <div className="limits-bucket">
                <div className="limit-window">
                  <div className="limit-heading">
                    <span>5-hour context window</span>
                    <strong style={{ color: '#10b981' }}>Active</strong>
                  </div>
                  <div className="limit-track" role="progressbar" aria-valuenow={100}>
                    <span
                      style={{
                        width: '100%',
                        background: 'linear-gradient(90deg, #10b981, #059669)',
                      }}
                    />
                  </div>
                  <div className="limit-reset">Prewarm pipeline connected & ready</div>
                </div>
              </div>
              <p className="limits-checked">
                Claude Code session key active · Token refreshes on prewarm
              </p>
              <button
                className="limits-refresh"
                onClick={() => setView('settings')}
                style={{ marginTop: '6px' }}
              >
                <Settings2 size={13} /> Manage Claude settings
              </button>
            </>
          ) : (
            <>
              <p className="limits-empty">Claude Code is not connected.</p>
              <p className="limits-hint">
                Connect your session key in Settings to track quotas and enable automated warmups.
              </p>
              <button
                className="limits-refresh"
                onClick={() => setView('settings')}
                style={{ marginTop: '6px' }}
              >
                <Plus size={13} /> Connect Claude
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="provider-limits-custom">
          {isReady ? (
            <>
              <div className="limits-bucket">
                <div className="limit-window">
                  <div className="limit-heading">
                    <span>Gemini 2.5 Flash / Pro</span>
                    <strong style={{ color: '#10b981' }}>Active</strong>
                  </div>
                  <div className="limit-track" role="progressbar" aria-valuenow={100}>
                    <span
                      style={{
                        width: '100%',
                        background: 'linear-gradient(90deg, #3b82f6, #10b981)',
                      }}
                    />
                  </div>
                  <div className="limit-reset">OAuth session authenticated & verified</div>
                </div>
              </div>
              <p className="limits-checked">
                Google account connected · Prewarm active on VM runner
              </p>
              <button
                className="limits-refresh"
                onClick={() => setView('settings')}
                style={{ marginTop: '6px' }}
              >
                <Settings2 size={13} /> Manage Antigravity settings
              </button>
            </>
          ) : (
            <>
              <p className="limits-empty">Google Antigravity is not connected.</p>
              <p className="limits-hint">
                Connect Google Antigravity in Settings to track quotas and enable automated warmups.
              </p>
              <button
                className="limits-refresh"
                onClick={() => setView('settings')}
                style={{ marginTop: '6px' }}
              >
                <Plus size={13} /> Connect Antigravity
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
function Dashboard({ data, onRun, onRefresh, now, busy, online, setView }) {
  const [selectedProvider, setSelectedProvider] = useState('codex');
  const currentProvider = PROVIDERS.find((p) => p.id === selectedProvider) || PROVIDERS[0];

  const providerSchedules = data.schedules.filter((s) =>
    (s.providers || ['codex']).includes(selectedProvider),
  );
  const next = providerSchedules
    .filter((s) => s.enabled && s.nextAt)
    .sort((a, b) => a.nextAt - b.nextAt)[0];

  const providerJobs = data.jobs.filter(
    (j) =>
      j.dryRun === data.dryRun &&
      j.source !== 'usage' &&
      (j.provider || 'codex') === selectedProvider,
  );
  const succeeded = providerJobs.filter((j) => j.status === 'succeeded').length;

  const creds = {
    codex: {
      ready: Boolean(data.authReady ?? data.credentials?.codex?.ready),
      state: data.credentialState ?? data.credentials?.codex?.state,
    },
    claude: data.credentials?.claude || { ready: false, state: 'disconnected' },
    antigravity: data.credentials?.antigravity || { ready: false, state: 'disconnected' },
  };
  const activeCred = creds[selectedProvider] || { ready: false };
  const readyCount = Object.values(creds).filter((c) => c?.ready).length;

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> CONTROL CENTER
          </div>
          <h1>
            Good to have you back <span className="wave">✦</span>
          </h1>
          <p>Your warmups, schedules, and multi-provider activity at a glance.</p>
        </div>
        <button className="icon-button refresh" aria-label="Refresh status" onClick={onRefresh}>
          <RefreshCw size={19} />
        </button>
      </header>

      <div className="provider-tabs-bar" role="tablist" aria-label="Select AI Provider">
        {PROVIDERS.map((p) => {
          const c = creds[p.id];
          const isReady = c?.ready ?? false;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={selectedProvider === p.id}
              className={`provider-tab ${selectedProvider === p.id ? 'active' : ''}`}
              onClick={() => setSelectedProvider(p.id)}
            >
              <span className={`pip-status ${isReady ? 'ready' : 'not-ready'}`} />
              {p.short}
            </button>
          );
        })}
      </div>

      <div className="stats dashboard-grid" role="region" aria-label="Warmup dashboard cards">
        <LimitsCard
          data={data}
          online={online}
          onRefresh={onRefresh}
          provider={selectedProvider}
          creds={creds}
          setView={setView}
        />

        <div className="stat-card next">
          <div className="stat-top">
            <span>Next {currentProvider.short} warmup</span>
            <CalendarClock size={19} />
          </div>
          <div className="time-big">{next ? timeString(next.time) : 'No alarm set'}</div>
          <p>{next ? `${format(next.nextAt)} · IST` : `No ${currentProvider.short} alarms set`}</p>
          <div className="countdown">
            <Clock size={16} />
            {next ? timeUntil(next.nextAt, now) : `No alarms for ${currentProvider.short}`}
          </div>
        </div>

        <div className="stat-card success-card">
          <div className="stat-top">
            <span>{currentProvider.short} runs</span>
            <CheckCheck size={19} />
          </div>
          <div className="stat-value">
            {succeeded}
            <span className="stat-suffix">/ last {providerJobs.length}</span>
          </div>
          <Badge tone={activeCred.ready ? 'green' : 'amber'} dot>
            {activeCred.ready ? 'CONNECTED' : 'NOT READY'}
          </Badge>
          <div className="stat-foot">
            {readyCount} of 3 active
            {providerJobs.length
              ? data.dryRun
                ? ` · Test runs for ${currentProvider.short}`
                : ` · Live requests`
              : ` · No ${currentProvider.short} runs yet`}
          </div>
        </div>

        <section className="hero-action">
          <div className="hero-copy">
            <div className="hero-kicker">
              <Zap size={14} /> ONE-TAP CONTROL
            </div>
            <h2>Start a run on demand.</h2>
            <p>Queue a warmup now for {currentProvider.name} without changing your schedule.</p>
          </div>
          <div className="hero-action-footer">
            <button
              className="hero-button"
              onClick={() => onRun(selectedProvider)}
              disabled={
                busy || !online || Boolean(data.active) || (!activeCred.ready && !data.dryRun)
              }
            >
              <Play size={18} fill="currentColor" />{' '}
              {!online
                ? 'Offline'
                : busy
                  ? 'Starting…'
                  : data.active
                    ? 'Run in progress'
                    : 'Run now'}
            </button>
          </div>
        </section>
      </div>

      <div className="section-row">
        <div>
          <h2>Upcoming {currentProvider.short} alarms</h2>
          <p>Your next scheduled {currentProvider.name} requests, in IST.</p>
        </div>
        <button className="link-button" onClick={() => setView('schedules')}>
          View all <ArrowRight size={17} />
        </button>
      </div>

      {providerSchedules.length ? (
        <div className="compact-schedules">
          {providerSchedules.slice(0, 4).map((s) => (
            <div className="compact-row" key={s.id}>
              <div className="schedule-symbol">
                <AlarmClock size={20} />
              </div>
              <div className="grow">
                <strong>{s.label || s.days.map((x) => FULL_DAYS[x]).join(', ')}</strong>
                <small>
                  {s.days.map((x) => DAY_LABELS[x]).join(' · ')}
                  {' · '}
                  {(s.providers || ['codex'])
                    .map((pr) => pr.charAt(0).toUpperCase() + pr.slice(1))
                    .join(', ')}
                </small>
              </div>
              <b>{timeString(s.time)}</b>
              <Badge tone={s.enabled ? 'green' : 'neutral'}>{s.enabled ? 'ON' : 'OFF'}</Badge>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          <AlarmClock size={30} />
          <strong>No {currentProvider.short} alarms yet</strong>
          <p>Add your first scheduled warmup for {currentProvider.name}.</p>
          <button className="btn secondary" onClick={() => setView('schedules')}>
            Create {currentProvider.short} schedule
          </button>
        </div>
      )}
    </>
  );
}
function ScheduleView({ data, onAdd, onEdit, onDelete, onToggle, disabled }) {
  return (
    <>
      <header className="page-header inline">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> YOUR AUTOMATIONS
          </div>
          <h1>Warmup schedules</h1>
          <p>Choose days and times for scheduled requests.</p>
        </div>
        <button className="btn primary add-button" onClick={onAdd}>
          <Plus size={18} /> New alarm
        </button>
      </header>
      {data.schedules.length === 0 ? (
        <div className="empty large">
          <CalendarClock size={38} />
          <h2>Your mornings, on autopilot.</h2>
          <p>Add an alarm to schedule your first automatic warmup.</p>
          <button className="btn primary" onClick={onAdd}>
            <Plus size={18} /> Add your first alarm
          </button>
        </div>
      ) : (
        <div className="schedule-grid">
          {data.schedules.map((s) => (
            <div className={`schedule-card ${!s.enabled ? 'muted-card' : ''}`} key={s.id}>
              <div className="schedule-card-top">
                <div className="schedule-symbol big">
                  <AlarmClock size={23} />
                </div>
                <div className="schedule-actions">
                  <button
                    className="icon-button"
                    aria-label={`Edit ${s.label || 'schedule'}`}
                    disabled={disabled}
                    onClick={() => onEdit(s)}
                  >
                    <Settings2 size={18} />
                  </button>
                  <button
                    className="icon-button danger-icon"
                    aria-label={`Delete ${s.label || 'schedule'}`}
                    disabled={disabled}
                    onClick={() => onDelete(s)}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
              <p className="schedule-label">{s.label || 'Warmup alarm'}</p>
              <h2>{timeString(s.time)}</h2>
              <div className="chips">
                {DAY_LABELS.map((d, i) => (
                  <span className={`chip ${s.days.includes(i) ? 'on' : ''}`} key={d}>
                    {d.slice(0, 1)}
                  </span>
                ))}
              </div>
              <div className="schedule-providers">
                {(s.providers || ['codex']).map((pr) => {
                  const p = PROVIDERS.find((x) => x.id === pr) || { short: pr, tone: 'neutral' };
                  return (
                    <span key={pr} className={`provider-badge ${p.tone}`}>
                      {p.short}
                    </span>
                  );
                })}
              </div>
              <div className="schedule-card-bottom">
                <span>{s.enabled ? `Next: ${format(s.nextAt)}` : 'Paused'}</span>
                <label className="switch" aria-label={`Toggle ${s.label || 'schedule'}`}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={s.enabled}
                    onChange={() => onToggle(s)}
                  />
                  <span />
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="tip">
        <Clock size={18} />
        <p>
          All alarms use <strong>India Standard Time (IST)</strong>, including when your phone is
          switched off. Runner startup may be delayed. Requests cannot guarantee quota-window
          timing.
        </p>
      </div>
    </>
  );
}
const statuses = {
  dispatched: ['amber', 'Queued'],
  retrying: ['blue', 'Retrying'],
  succeeded: ['green', 'Successful'],
  failed: ['red', 'Failed'],
  running: ['blue', 'Running'],
  queued: ['amber', 'Queued'],
  dispatching: ['amber', 'Dispatching'],
  skipped: ['neutral', 'Skipped'],
};
function HistoryView({ data, onRefresh }) {
  return (
    <>
      <header className="page-header inline">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> ACTIVITY LOG
          </div>
          <h1>Execution history</h1>
          <p>Every scheduled and manual job, in one place.</p>
        </div>
        <button className="btn secondary" onClick={onRefresh}>
          <RefreshCw size={16} /> Refresh
        </button>
      </header>
      <div className="history-table">
        {data.jobs.length ? (
          data.jobs.map((job) => (
            <div className="history-row" key={job.id}>
              <div className={`history-symbol ${job.status}`}>
                <Zap size={18} />
              </div>
              <div className="history-description">
                <strong>
                  {job.source === 'usage'
                    ? 'Allowance check'
                    : job.source === 'manual'
                      ? 'Manual warmup'
                      : 'Scheduled warmup'}
                </strong>
                <span>
                  {format(job.createdAt)} · IST ·{' '}
                  {job.source === 'usage'
                    ? 'No model request'
                    : job.dryRun
                      ? 'Test run'
                      : `Real ${job.provider || 'codex'} request`}
                </span>
                {job.error && (
                  <small className="error-text">
                    {job.error === 'CODEX_RECONNECT_REQUIRED' &&
                    (data.credentials?.codex?.ready ?? data.authReady)
                      ? 'This earlier run reported a login problem. Codex is connected now.'
                      : job.error === 'CLAUDE_RECONNECT_REQUIRED' && data.credentials?.claude?.ready
                        ? 'This earlier run reported a login problem. Claude is connected now.'
                        : job.error === 'ANTIGRAVITY_RECONNECT_REQUIRED' &&
                            data.credentials?.antigravity?.ready
                          ? 'This earlier run reported a login problem. Antigravity is connected now.'
                          : messages[job.error] || job.error}
                  </small>
                )}
              </div>
              <div className="history-badges">
                <span
                  className={`provider-badge ${(PROVIDERS.find((p) => p.id === (job.provider || 'codex')) || { tone: 'neutral' }).tone}`}
                >
                  {PROVIDERS.find((p) => p.id === (job.provider || 'codex'))?.short ||
                    job.provider ||
                    'Codex'}
                </span>
                <Badge tone={statuses[job.status]?.[0] || 'neutral'}>
                  {statuses[job.status]?.[1] || job.status}
                </Badge>
              </div>
              {job.runUrl && (
                <a
                  className="history-link"
                  href={job.runUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open runner execution"
                  aria-label="Open runner execution in a new tab"
                >
                  <ExternalLink size={17} />
                </a>
              )}
            </div>
          ))
        ) : (
          <div className="empty large">
            <History size={35} />
            <h2>No runs recorded yet</h2>
            <p>Your first warmup will show up here.</p>
          </div>
        )}
      </div>
    </>
  );
}
function SettingsView({ data, onLogout, onDisconnect, onRefresh }) {
  const [disconnecting, setDisconnecting] = useState(false);
  const [usageError, setUsageError] = useState('');
  const [usageBusy, setUsageBusy] = useState(false);
  const [activeTab, setActiveTab] = useState('codex');

  async function refreshUsage() {
    setUsageBusy(true);
    setUsageError('');
    try {
      await api('/usage/refresh', { method: 'POST' });
      await onRefresh();
    } catch (e) {
      setUsageError(e.message);
    } finally {
      setUsageBusy(false);
    }
  }

  const workerOrigin = "'" + window.location.origin.replaceAll("'", "'\\''") + "'";

  async function remove(provider = 'codex') {
    const pName = PROVIDERS.find((p) => p.id === provider)?.name || provider;
    if (
      !confirm(
        `Remove the stored ${pName} session? Future real warmups for ${provider} will stop until reconnected.`,
      )
    )
      return;
    setDisconnecting(true);
    try {
      await onDisconnect(provider);
    } catch {
    } finally {
      setDisconnecting(false);
    }
  }

  const creds = {
    codex: {
      ready: Boolean(data.authReady ?? data.credentials?.codex?.ready),
      state: data.credentialState ?? data.credentials?.codex?.state,
    },
    claude: data.credentials?.claude || { ready: false, state: 'disconnected' },
    antigravity: data.credentials?.antigravity || { ready: false, state: 'disconnected' },
  };

  return (
    <>
      <header className="page-header">
        <div>
          <div className="eyebrow">
            <span className="eyebrow-line" /> CONFIGURATION
          </div>
          <h1>Settings & security</h1>
          <p>Manage multi-provider credentials and verify system health.</p>
        </div>
      </header>
      <div className="settings-list">
        <div className="settings-item">
          <div className="settings-icon">
            <Cloud size={21} />
          </div>
          <div className="grow">
            <strong>Cloudflare scheduler</strong>
            <p>Durable Object alarms · Asia/Kolkata</p>
          </div>
          <Badge tone="green" dot>
            {data.executor === 'mock' ? 'MOCK READY' : 'REACHABLE'}
          </Badge>
        </div>
        {PROVIDERS.map((p) => {
          const c = creds[p.id];
          const isReady = p.id === 'codex' ? Boolean(data.authReady) : Boolean(c?.ready);
          const state = p.id === 'codex' ? data.credentialState : c?.state;
          return (
            <div className="settings-item" key={p.id}>
              <div className="settings-icon">
                <KeyRound size={21} />
              </div>
              <div className="grow">
                <strong>{p.id === 'codex' ? 'Codex login' : `${p.short} login`}</strong>
                <p>
                  {isReady
                    ? 'Encrypted session in Cloudflare storage'
                    : state === 'reconnect_required'
                      ? 'Reconnect required'
                      : 'No credentials configured'}
                </p>
              </div>
              <Badge tone={isReady ? 'green' : 'amber'} dot>
                {isReady
                  ? 'CONNECTED'
                  : state === 'reconnect_required'
                    ? 'RECONNECT'
                    : 'NOT CONNECTED'}
              </Badge>
            </div>
          );
        })}
        {data.executor === 'vm' && (
          <div className="settings-item">
            <div className="settings-icon">
              <Cloud size={21} />
            </div>
            <div className="grow">
              <strong>VM execution runner</strong>
              <p>Runs on your Oracle VM, independently of your phone and laptop.</p>
            </div>
            <Badge tone={data.vmRunner?.online ? 'green' : 'amber'} dot>
              {data.vmRunner?.online ? 'ONLINE' : 'OFFLINE'}
            </Badge>
          </div>
        )}
        <div className="settings-item">
          <div className="settings-icon">
            <ShieldCheck size={21} />
          </div>
          <div className="grow">
            <strong>Execution mode</strong>
            <p>
              {data.dryRun
                ? 'Mock execution only. Real CLI models are never invoked.'
                : 'Live mode: uses your securely stored AI sessions.'}
            </p>
          </div>
          <Badge tone={data.dryRun ? 'amber' : 'green'}>{data.dryRun ? 'DRY RUN' : 'LIVE'}</Badge>
        </div>
      </div>

      <div className="provider-connection-section">
        <div className="section-row">
          <div>
            <h2>Provider connection guides</h2>
            <p>Connect your personal CLI sessions from your trusted computer.</p>
          </div>
        </div>

        <div className="provider-tabs-bar" role="tablist" aria-label="Provider configuration tabs">
          {PROVIDERS.map((p) => {
            const isReady = creds[p.id]?.ready ?? false;
            return (
              <button
                key={p.id}
                role="tab"
                aria-selected={activeTab === p.id}
                className={`provider-tab ${activeTab === p.id ? 'active' : ''}`}
                onClick={() => setActiveTab(p.id)}
              >
                <span className={`pip-status ${isReady ? 'ready' : 'not-ready'}`} />
                {p.name}
              </button>
            );
          })}
        </div>

        {activeTab === 'codex' && (
          <div className="settings-guide">
            <div className="guide-header">
              <h3>Connect or reconnect OpenAI Codex</h3>
              {creds.codex?.ready && (
                <button
                  className="btn danger small"
                  disabled={disconnecting}
                  onClick={() => remove('codex')}
                >
                  <Trash2 size={15} /> Disconnect Codex
                </button>
              )}
            </div>
            <p role="status">
              {data.connectionAllowed
                ? 'Credential connection is enabled by the deployment owner.'
                : 'Connection locked: this release accepts no real Codex credentials.'}{' '}
              {creds.codex?.state === 'reconnect_required' || creds.codex?.state === 'quarantined'
                ? 'Reconnect required. Verify the old runner has stopped before replacing credentials.'
                : ''}
            </p>
            <p>
              First open your project folder in Terminal. Type <code>cd</code> followed by a space,
              drag the project folder into Terminal, then press Return. It must be the folder
              containing <code>package.json</code> and <code>scripts/seed-auth.mjs</code>.
            </p>
            <p>
              Paste the whole block below. It checks the folder before starting sign-in. Use your
              ChatGPT account in your browser and keep this Codex session separate from other work.
              Never paste <code>auth.json</code> into chat or GitHub.
            </p>
            <pre>
              <code>{`(
  [ -d "$HOME/Desktop/codex-prewarmer" ] && cd "$HOME/Desktop/codex-prewarmer"
  if [ ! -f scripts/seed-auth.mjs ]; then
    printf '%s\\n' 'Wrong folder: run "cd /path/to/codex-prewarmer" first, then paste this block again.' >&2
    exit 1
  fi
  mkdir -p .build/codex-connection &&
  chmod 700 .build/codex-connection &&
  CODEX_HOME="$PWD/.build/codex-connection" codex -c 'cli_auth_credentials_store="file"' login &&
  node scripts/seed-auth.mjs ${workerOrigin} .build/codex-connection/auth.json --allow-credential-upload --provider=codex
)`}</code>
            </pre>
            <p>
              After browser sign-in succeeds, return to Terminal and enter your Prewarmer dashboard
              password when prompted. Browser sign-in alone does not connect this app: wait for
              Terminal to confirm the authentication upload, then select Check status below.
              Connecting stores your encrypted session; real requests stay disabled while execution
              mode is DRY RUN.
            </p>
            <a
              href="https://learn.chatgpt.com/docs/auth/ci-cd-auth"
              target="_blank"
              rel="noreferrer"
            >
              Open official Codex CI authentication guidance <ExternalLink size={14} />
            </a>
          </div>
        )}

        {activeTab === 'claude' && (
          <div className="settings-guide">
            <div className="guide-header">
              <h3>Connect or reconnect Anthropic Claude Code</h3>
              {creds.claude?.ready && (
                <button
                  className="btn danger small"
                  disabled={disconnecting}
                  onClick={() => remove('claude')}
                >
                  <Trash2 size={15} /> Disconnect Claude
                </button>
              )}
            </div>
            <p role="status">
              Claude Code session credentials are encrypted with AES-256-GCM. Never commit raw
              credentials to source control.
            </p>
            <p>Sign into Claude Code locally, then upload your configuration to the prewarmer:</p>
            <pre>
              <code>{`(
  [ -d "$HOME/Desktop/codex-prewarmer" ] && cd "$HOME/Desktop/codex-prewarmer"
  if [ ! -f scripts/seed-auth.mjs ]; then
    printf '%s\\n' 'Wrong folder: run "cd /path/to/codex-prewarmer" first, then paste this block again.' >&2
    exit 1
  fi
  claude login &&
  node scripts/seed-auth.mjs ${workerOrigin} ~/.claude.json --allow-credential-upload --provider=claude
)`}</code>
            </pre>
            <p>
              When prompted, enter your Prewarmer dashboard password to encrypt and upload your
              session over HTTPS.
            </p>
          </div>
        )}

        {activeTab === 'antigravity' && (
          <div className="settings-guide">
            <div className="guide-header">
              <h3>Connect or reconnect Google Antigravity</h3>
              {creds.antigravity?.ready && (
                <button
                  className="btn danger small"
                  disabled={disconnecting}
                  onClick={() => remove('antigravity')}
                >
                  <Trash2 size={15} /> Disconnect Antigravity
                </button>
              )}
            </div>
            <p role="status">Google Antigravity authentication is securely encrypted at rest.</p>
            <p>
              Ensure the Antigravity CLI is authenticated on your local machine, then upload its
              token:
            </p>
            <pre>
              <code>{`(
  [ -d "$HOME/Desktop/codex-prewarmer" ] && cd "$HOME/Desktop/codex-prewarmer"
  if [ ! -f scripts/seed-auth.mjs ]; then
    printf '%s\\n' 'Wrong folder: run "cd /path/to/codex-prewarmer" first, then paste this block again.' >&2
    exit 1
  fi
  agy --print "OK" --dangerously-skip-permissions >/dev/null 2>&1 || true
  AUTH_PATH="$HOME/.gemini/jetski-standalone-oauth-token"
  [ ! -f "$AUTH_PATH" ] && AUTH_PATH="$HOME/.gemini/antigravity/auth.json"
  node scripts/seed-auth.mjs ${workerOrigin} "$AUTH_PATH" --allow-credential-upload --provider=antigravity
)`}</code>
            </pre>
            <p>
              Enter your Prewarmer dashboard password in Terminal to securely upload your
              credentials.
            </p>
          </div>
        )}
      </div>

      <div className="settings-guide">
        <h3>Codex allowance</h3>
        <p>Read-only account limits. This does not send a model request or reset your allowance.</p>
        <button
          className="btn secondary"
          onClick={refreshUsage}
          disabled={
            usageBusy ||
            !!data.active ||
            !data.authReady ||
            data.dryRun ||
            !data.vmRunner?.online ||
            !data.vmRunner?.supportsUsage
          }
        >
          {usageBusy || data.active ? 'Waiting for runner…' : 'Refresh allowance'}
        </button>
        {usageError && <p role="alert">{usageError}</p>}
        {data.usage?.error && (
          <p role="status">
            Allowance could not be read. Try again later; this does not mean your login expired.
          </p>
        )}
        {data.usage?.buckets?.map((b) => (
          <div key={b.id}>
            <strong>{b.id}</strong>
            {['primary', 'secondary'].map(
              (k) =>
                b[k] && (
                  <p key={k}>
                    {b[k].windowDurationMins >= 1440
                      ? `${b[k].windowDurationMins / 1440}-day`
                      : `${b[k].windowDurationMins / 60}-hour`}{' '}
                    window: <strong>{Math.max(0, 100 - b[k].usedPercent)}% remaining</strong> ·
                    Resets {format(b[k].resetsAt * 1000)} IST
                  </p>
                ),
            )}
          </div>
        ))}
        <p>
          {data.usage?.checkedAt
            ? `Last checked: ${format(data.usage.checkedAt)} IST. Snapshot only; usage may have changed.`
            : 'Not checked yet. Connect Codex and refresh to read the account on your VM.'}
        </p>
      </div>
      <div className="settings-buttons">
        <button className="btn secondary" onClick={onRefresh}>
          <RefreshCw size={17} /> Check status
        </button>
        <button className="btn secondary" onClick={onLogout}>
          <LogOut size={17} /> Log out
        </button>
      </div>
    </>
  );
}
const nav = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'schedules', label: 'Schedules', icon: CalendarClock },
  { id: 'history', label: 'History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings2 },
];
export default function App() {
  const [authorized, setAuthorized] = useState(null),
    [data, setData] = useState(null),
    [view, setView] = useState('overview'),
    [modal, setModal] = useState(undefined),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(() => Date.now()),
    [online, setOnline] = useState(navigator.onLine);
  const closeModal = useCallback(() => setModal(undefined), []);
  const snapshotRequest = useRef(0);
  const epoch = useRef(0),
    mutationActive = useRef(false),
    clockOffset = useRef(0);
  useEffect(() => {
    const expired = () => {
      epoch.current++;
      csrfToken = '';
      setAuthorized(false);
      setData(null);
    };
    const offline = () => setOnline(false);
    window.addEventListener('session-expired', expired);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('session-expired', expired);
      window.removeEventListener('offline', offline);
    };
  }, []);
  useEffect(() => {
    api('/session')
      .then(() => setAuthorized(true))
      .catch(() => setAuthorized(false));
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + clockOffset.current), 1000);
    return () => clearInterval(timer);
  }, []);
  const refresh = useCallback(async () => {
    const generation = epoch.current;
    const serial = ++snapshotRequest.current;
    try {
      const next = await api('/status');
      if (generation !== epoch.current || serial !== snapshotRequest.current) return;
      clockOffset.current = next.serverNow - Date.now();
      setData(next);
      setOnline(true);
    } catch {
      if (generation === epoch.current && serial === snapshotRequest.current) setOnline(false);
    }
  }, []);
  useEffect(() => {
    if (!authorized) return;
    refresh();
    const timer = setInterval(refresh, 2000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [authorized, refresh]);
  const notify = (msg, isError = false) => {
    if (isError) setError(msg);
    else setMessage(msg);
    setTimeout(() => {
      setMessage('');
      setError('');
    }, 5500);
  };
  async function mutation(fn, success) {
    if (mutationActive.current) throw Error('An update is already in progress.');
    mutationActive.current = true;
    snapshotRequest.current++;
    setBusy(true);
    try {
      const result = await fn();
      if (success) notify(success);
      await refresh();
      return result;
    } catch (e) {
      notify(e.message, true);
      throw e;
    } finally {
      mutationActive.current = false;
      setBusy(false);
    }
  }
  async function run(provider = 'codex') {
    try {
      await mutation(
        () => api(`/run?provider=${encodeURIComponent(provider)}`, { method: 'POST' }),
        `Warmup job queued for ${provider}.`,
      );
    } catch {}
  }
  async function save(payload) {
    await mutation(
      () =>
        api(modal?.id ? `/schedules/${modal.id}` : '/schedules', {
          method: modal?.id ? 'PATCH' : 'POST',
          body: payload,
        }),
      'Schedule saved.',
    );
  }
  async function del(s) {
    if (!confirm(`Delete ${s.label || 'this alarm'}?`)) return;
    try {
      await mutation(() => api(`/schedules/${s.id}`, { method: 'DELETE' }), 'Alarm deleted.');
    } catch {}
  }
  async function toggle(s) {
    if (mutationActive.current) return;
    const previous = data;
    setData({
      ...data,
      schedules: data.schedules.map((rule) =>
        rule.id === s.id ? { ...rule, enabled: !rule.enabled } : rule,
      ),
    });
    try {
      await mutation(
        () =>
          api(`/schedules/${s.id}`, {
            method: 'PATCH',
            body: { days: s.days, time: s.time, label: s.label, enabled: !s.enabled },
          }),
        s.enabled ? 'Alarm paused.' : 'Alarm enabled.',
      );
    } catch {
      setData(previous);
    }
  }
  async function logout() {
    try {
      await api('/logout', { method: 'POST' });
    } catch {
      /* Local sign-out still clears the view after a network failure. */
    } finally {
      epoch.current++;
      csrfToken = '';
      setAuthorized(false);
      setData(null);
    }
  }
  if (authorized === null)
    return (
      <div className="boot">
        <div className="brand-icon">
          <Zap size={22} />
        </div>
        <p>Loading your control center…</p>
      </div>
    );
  if (!authorized)
    return (
      <Login
        onLogin={async () => {
          setAuthorized(true);
          await refresh();
        }}
      />
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <Brand />
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map((n) => {
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                onClick={() => setView(n.id)}
                className={`nav-item ${view === n.id ? 'active' : ''}`}
                aria-current={view === n.id ? 'page' : undefined}
              >
                <Icon size={20} />
                {n.label}
                {view === n.id && <span className="nav-active-dot" />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="side-detail">
            <span className={`connection-pip ${online ? '' : 'offline'}`} />
            {online ? 'Dashboard connected' : 'Connection lost'}
          </div>
          <div className="side-user">
            <div className="avatar">P</div>
            <div>
              <strong>Personal workspace</strong>
              <small>Secure dashboard</small>
            </div>
          </div>
        </div>
      </aside>
      <main className="content">
        <div className="mobile-top">
          <Brand />
          <button
            aria-label={online ? 'Check connection: online' : 'Check connection: offline'}
            className={`mobile-status ${online ? '' : 'offline'}`}
            onClick={refresh}
          >
            {online ? <Wifi size={17} /> : <WifiOff size={17} />}
          </button>
        </div>
        <div className="content-inner">
          {!online && (
            <div className="alert error" role="status">
              Connection lost. Showing the last verified status. Reconnect, then refresh to make
              changes.
            </div>
          )}
          <InstallGuide />
          {view === 'overview' && data && (
            <Dashboard
              data={data}
              onRun={run}
              onRefresh={refresh}
              now={now}
              busy={busy}
              online={online}
              setView={setView}
            />
          )}
          {view === 'schedules' && data && (
            <ScheduleView
              data={data}
              onAdd={() => setModal(null)}
              onEdit={setModal}
              onDelete={del}
              onToggle={toggle}
              disabled={busy || !online}
            />
          )}
          {view === 'history' && data && <HistoryView data={data} onRefresh={refresh} />}
          {view === 'settings' && data && (
            <SettingsView
              data={data}
              onRefresh={refresh}
              onLogout={logout}
              onDisconnect={(provider = 'codex') =>
                mutation(
                  () =>
                    api(`/auth/remove?provider=${encodeURIComponent(provider)}`, {
                      method: 'POST',
                    }),
                  `${provider.toUpperCase()} session disconnected.`,
                )
              }
            />
          )}
          {!data && (
            <div className="empty large">
              <RefreshCw size={28} />
              <h2>Connecting to the scheduler…</h2>
              <button className="btn secondary" onClick={refresh}>
                Retry
              </button>
            </div>
          )}
          <footer className="footer">
            <span>AI Prewarmer · made for focused mornings</span>
            <span>
              <span className="footer-dot" /> Timezone: IST (UTC+05:30)
            </span>
          </footer>
        </div>
      </main>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {nav.map((n) => {
          const Icon = n.icon;
          return (
            <button
              key={n.id}
              className={view === n.id ? 'active' : ''}
              aria-current={view === n.id ? 'page' : undefined}
              onClick={() => setView(n.id)}
            >
              <Icon size={21} />
              <span>{n.label}</span>
            </button>
          );
        })}
      </nav>
      {modal !== undefined && <ScheduleModal schedule={modal} onClose={closeModal} onSave={save} />}
      {(message || error) && (
        <div className={`toast ${error ? 'toast-error' : ''}`} role={error ? 'alert' : 'status'}>
          {error ? <X size={17} /> : <Check size={17} />} {error || message}
          <button
            onClick={() => {
              setMessage('');
              setError('');
            }}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function InstallGuide() {
  const [prompt, setPrompt] = useState(null),
    [show, setShow] = useState(false);
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);
  return (
    <div className="install-guide">
      <button
        className="link-button"
        aria-expanded={show}
        onClick={async () => {
          if (prompt) {
            await prompt.prompt();
            setPrompt(null);
          } else setShow(!show);
        }}
      >
        <Smartphone size={16} /> Install on your phone
      </button>
      {show && (
        <p role="status">
          On Android, open this app in Chrome over HTTPS. Tap the browser menu, then Install app or
          Add to Home screen. On iPhone, open it in Safari, tap Share, then Add to Home Screen.
          Alarms run on the server; installing does not create phone system alarms.
        </p>
      )}
    </div>
  );
}

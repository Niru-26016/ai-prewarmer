import type { Schedule, Job, Credential, Provider } from './contracts';

/** SQL writes in a transaction are synchronous; no external I/O may run inside it. */
export class Store {
  constructor(private storage: DurableObjectState['storage']) {}
  sql(query: string, ...params: (string | number | null)[]) {
    return this.storage.sql.exec(query, ...params).toArray();
  }
  transaction<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }
  migrate() {
    this.transaction(() => {
      this.sql('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)');
      if (!this.sql('SELECT version FROM schema_migrations WHERE version = 1').length) {
        this.sql('CREATE TABLE schedules (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
        this.sql(
          'CREATE TABLE jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL)',
        );
        this.sql('CREATE TABLE metadata (key TEXT PRIMARY KEY, data TEXT NOT NULL)');
        this.sql(
          'CREATE TABLE dedupe (key TEXT PRIMARY KEY, job_id TEXT NOT NULL, expires_at INTEGER NOT NULL)',
        );
        this.sql(
          'CREATE TABLE sessions (id TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL)',
        );
        this.sql(
          'CREATE TABLE login_guard (id TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)',
        );
        this.sql('INSERT INTO schema_migrations (version) VALUES (1)');
      }
    });
  }
  get<T>(key: string): T | null {
    const row = this.sql('SELECT data FROM metadata WHERE key = ?', key)[0];
    return row ? (JSON.parse(String(row.data)) as T) : null;
  }
  put(key: string, data: unknown) {
    this.sql(
      'INSERT INTO metadata VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET data=excluded.data',
      key,
      JSON.stringify(data),
    );
  }
  schedules(): Schedule[] {
    return this.sql('SELECT data FROM schedules ORDER BY rowid').map((r) => {
      const s = JSON.parse(String(r.data)) as Schedule;
      if (!s.providers || !s.providers.length) s.providers = ['codex'];
      return s;
    });
  }
  schedule(s: Schedule) {
    const payload = { ...s, providers: s.providers?.length ? s.providers : ['codex'] };
    this.sql(
      'INSERT INTO schedules VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      s.id,
      JSON.stringify(payload),
    );
  }
  jobs(): Job[] {
    return this.sql(
      `SELECT data FROM jobs WHERE id IN (
        SELECT id FROM (SELECT id FROM jobs WHERE json_extract(data, '$.source') != 'usage'
          ORDER BY created_at DESC, rowid DESC LIMIT 100)
        UNION ALL
        SELECT id FROM (SELECT id FROM jobs WHERE json_extract(data, '$.source') = 'usage'
          ORDER BY created_at DESC, rowid DESC LIMIT 20)
      ) ORDER BY created_at DESC, rowid DESC`,
    ).map((r) => {
      const j = JSON.parse(String(r.data)) as Job;
      if (!j.provider) j.provider = 'codex';
      return j;
    });
  }
  job(id: string): Job | null {
    const r = this.sql('SELECT data FROM jobs WHERE id = ?', id)[0];
    if (!r) return null;
    const j = JSON.parse(String(r.data)) as Job;
    if (!j.provider) j.provider = 'codex';
    return j;
  }
  saveJob(j: Job) {
    const payload = { ...j, provider: j.provider || 'codex' };
    this.sql(
      'INSERT INTO jobs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      j.id,
      JSON.stringify(payload),
      j.createdAt,
    );
  }
  active(): Job | null {
    const id = this.get<string | null>('active');
    return id ? this.job(id) : null;
  }
  credential(provider: Provider = 'codex'): Credential {
    const specific = this.get<Credential>(`credential:${provider}`);
    if (specific) return specific;
    if (provider === 'codex') {
      return (
        this.get<Credential>('credential') ?? { version: 0, state: 'disconnected', blob: null }
      );
    }
    return { version: 0, state: 'disconnected', blob: null };
  }
  setCredential(provider: Provider, cred: Credential) {
    this.put(`credential:${provider}`, cred);
    if (provider === 'codex') {
      this.put('credential', cred);
    }
  }
  credentials(): Record<Provider, Credential> {
    return {
      codex: this.credential('codex'),
      claude: this.credential('claude'),
      antigravity: this.credential('antigravity'),
    };
  }
  prune(now: number) {
    this.sql('DELETE FROM dedupe WHERE expires_at <= ?', now);
    this.sql('DELETE FROM sessions WHERE expires_at <= ?', now);
    this.sql('DELETE FROM login_guard WHERE expires_at <= ?', now);
    this.sql(
      `DELETE FROM jobs WHERE id NOT IN (
        SELECT id FROM (SELECT id FROM jobs WHERE json_extract(data, '$.source') != 'usage'
          ORDER BY created_at DESC, rowid DESC LIMIT 100)
        UNION ALL
        SELECT id FROM (SELECT id FROM jobs WHERE json_extract(data, '$.source') = 'usage'
          ORDER BY created_at DESC, rowid DESC LIMIT 20)
      ) AND id != ?`,
      this.active()?.id ?? '',
    );
  }
}

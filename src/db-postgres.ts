import pg from 'pg';
import { AsyncLocalStorage } from 'async_hooks';
import type { DbClient, RunResult } from './db-types.js';

const { Pool, types } = pg;

// Return BIGINT / BIGSERIAL as numbers (timestamps, ids).
types.setTypeParser(types.builtins.INT8, (value) => parseInt(value, 10));

const txContext = new AsyncLocalStorage<PostgresSession>();

const FACT_TSVECTOR = `
  to_tsvector(
    'english',
    coalesce(namespace, '') || ' ' ||
    coalesce(key, '') || ' ' ||
    coalesce(value, '') || ' ' ||
    coalesce(description, '') || ' ' ||
    coalesce(fact_type, '') || ' ' ||
    coalesce(subject, '') || ' ' ||
    coalesce(scope, '') || ' ' ||
    coalesce(status, '') || ' ' ||
    coalesce(derivation, '') || ' ' ||
    coalesce(source, '') || ' ' ||
    coalesce(evidence, '') || ' ' ||
    coalesce(time_period, '') || ' ' ||
    coalesce(audience, '') || ' ' ||
    coalesce(relevance_tags, '') || ' ' ||
    coalesce(actionability, '') || ' ' ||
    coalesce(owner, '') || ' ' ||
    coalesce(priority, '') || ' ' ||
    coalesce(created_by, '') || ' ' ||
    coalesce(approval_status, '') || ' ' ||
    coalesce(registry_channel, '')
  )
`;

function toPgSql(sql: string): string {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
}

function wantsSsl(connectionString: string): boolean {
    return (
        /sslmode=(require|verify-ca|verify-full)/i.test(connectionString) ||
        process.env.DATABASE_SSL === 'require' ||
        /amazonaws\.com/i.test(connectionString)
    );
}

/** Strip sslmode from the URL so `pg` does not force verify-full; use Pool ssl instead. */
function poolConfig(connectionString: string): pg.PoolConfig {
    const useSsl = wantsSsl(connectionString);
    let cs = connectionString
        .replace(/([?&])sslmode=[^&]*/gi, '$1')
        .replace(/[?&]$/, '')
        .replace(/\?&/, '?')
        .replace(/&&+/g, '&');
    if (cs.endsWith('?')) {
        cs = cs.slice(0, -1);
    }
    return {
        connectionString: cs,
        ssl: useSsl ? { rejectUnauthorized: false } : undefined
    };
}

async function ensureDatabaseExists(connectionString: string): Promise<void> {
    let url: URL;
    try {
        url = new URL(connectionString);
    } catch {
        return;
    }

    const database = decodeURIComponent(url.pathname.replace(/^\//, '') || '');
    if (!database || database === 'postgres') {
        return;
    }

    const adminUrl = new URL(connectionString);
    adminUrl.pathname = '/postgres';

    const adminPool = new Pool(poolConfig(adminUrl.toString()));
    try {
        const result = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
        if (result.rowCount === 0) {
            // Identifiers cannot be parameterized; database name comes from DATABASE_URL only.
            await adminPool.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
            console.log(`[unifact] Created PostgreSQL database '${database}'`);
        }
    } catch (err) {
        // Connecting to an existing DB is fine; creation is best-effort for first boot.
        console.warn('[unifact] Could not ensure PostgreSQL database exists:', err instanceof Error ? err.message : err);
    } finally {
        await adminPool.end();
    }
}

async function initializeSchema(pool: pg.Pool): Promise<void> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS facts (
        rowid BIGSERIAL PRIMARY KEY,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        description TEXT,
        fact_type TEXT NOT NULL DEFAULT 'entity_fact',
        subject TEXT,
        scope TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        derivation TEXT NOT NULL DEFAULT 'asserted',
        confidence DOUBLE PRECISION,
        source TEXT,
        evidence TEXT,
        valid_from BIGINT,
        valid_until BIGINT,
        observed_at BIGINT,
        time_period TEXT,
        audience TEXT,
        relevance_tags TEXT,
        actionability TEXT NOT NULL DEFAULT 'informational',
        owner TEXT,
        priority TEXT NOT NULL DEFAULT 'normal',
        related_facts TEXT,
        created_by TEXT,
        approved_by TEXT,
        approval_status TEXT NOT NULL DEFAULT 'unreviewed',
        registry_channel TEXT NOT NULL DEFAULT 'working',
        version INTEGER NOT NULL DEFAULT 1,
        published_at BIGINT,
        published_by TEXT,
        change_reason TEXT,
        supersedes TEXT,
        superseded_by TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE(namespace, key)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        old_snapshot TEXT,
        new_snapshot TEXT,
        timestamp BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fact_versions (
        id SERIAL PRIMARY KEY,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        version INTEGER NOT NULL,
        event TEXT NOT NULL,
        registry_channel TEXT NOT NULL,
        snapshot TEXT NOT NULL,
        author TEXT,
        change_reason TEXT,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        role TEXT NOT NULL,
        allowed_fact_types TEXT NOT NULL DEFAULT '[]',
        writable_fact_types TEXT NOT NULL DEFAULT '[]',
        relevant_scopes TEXT NOT NULL DEFAULT '[]',
        relevant_subjects TEXT NOT NULL DEFAULT '[]',
        intents TEXT NOT NULL DEFAULT '[]',
        audience_tags TEXT NOT NULL DEFAULT '[]',
        can_propose_facts INTEGER NOT NULL DEFAULT 1,
        can_approve_facts INTEGER NOT NULL DEFAULT 0,
        allowed_actions TEXT NOT NULL DEFAULT '[]',
        requires_human_approval_for TEXT NOT NULL DEFAULT '[]',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        person TEXT NOT NULL UNIQUE,
        api_key TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        namespaces TEXT NOT NULL DEFAULT '["*"]',
        scopes TEXT NOT NULL DEFAULT '["read","write"]',
        registry_name TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS registries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        owner_person TEXT NOT NULL,
        description TEXT,
        git_url TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS join_requests (
        id TEXT PRIMARY KEY,
        registry_name TEXT NOT NULL,
        person TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        message TEXT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE(registry_name, person)
      );

      CREATE INDEX IF NOT EXISTS idx_facts_namespace ON facts(namespace);
      CREATE INDEX IF NOT EXISTS idx_facts_type ON facts(fact_type);
      CREATE INDEX IF NOT EXISTS idx_facts_status ON facts(status);
      CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject);
      CREATE INDEX IF NOT EXISTS idx_facts_scope ON facts(scope);
      CREATE INDEX IF NOT EXISTS idx_facts_actionability ON facts(actionability);
      CREATE INDEX IF NOT EXISTS idx_facts_registry_channel ON facts(registry_channel);
      CREATE INDEX IF NOT EXISTS idx_facts_version ON facts(namespace, key, version);
      CREATE INDEX IF NOT EXISTS idx_fact_versions_fact ON fact_versions(namespace, key, version);
      CREATE INDEX IF NOT EXISTS idx_fact_versions_event ON fact_versions(event);
      CREATE INDEX IF NOT EXISTS idx_agent_profiles_role ON agent_profiles(role);
      CREATE INDEX IF NOT EXISTS idx_api_keys_person ON api_keys(person);
      CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);
      CREATE INDEX IF NOT EXISTS idx_api_keys_enabled ON api_keys(enabled);
      CREATE INDEX IF NOT EXISTS idx_registries_owner ON registries(owner_person);
      CREATE INDEX IF NOT EXISTS idx_join_requests_registry ON join_requests(registry_name);
      CREATE INDEX IF NOT EXISTS idx_join_requests_status ON join_requests(status);
    `);

    await pool.query(`
      ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS registry_name TEXT
    `).catch(() => undefined);
}

type Queryable = {
    query: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;
};

class PostgresSession implements DbClient {
    readonly backend = 'postgres' as const;
    readonly name = 'postgres';

    constructor(private readonly q: Queryable) {}

    async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
        const result = await this.q.query(toPgSql(sql), params);
        return result.rows[0] as T | undefined;
    }

    async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
        const result = await this.q.query(toPgSql(sql), params);
        return result.rows as T[];
    }

    async run(sql: string, params: unknown[] = []): Promise<RunResult> {
        const result = await this.q.query(toPgSql(sql), params);
        return { changes: result.rowCount ?? 0 };
    }

    async exec(sql: string): Promise<void> {
        await this.q.query(sql);
    }

    async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
        const existing = txContext.getStore();
        if (existing) {
            return fn(existing);
        }

        if (!(this.q instanceof Pool)) {
            return fn(this);
        }

        const client = await (this.q as pg.Pool).connect();
        const session = new PostgresSession(client);
        try {
            await client.query('BEGIN');
            const result = await txContext.run(session, () => fn(session));
            await client.query('COMMIT');
            return result;
        } catch (err) {
            try {
                await client.query('ROLLBACK');
            } catch {
                // ignore rollback errors
            }
            throw err;
        } finally {
            client.release();
        }
    }

    factSearchClause(): string {
        return `${FACT_TSVECTOR} @@ plainto_tsquery('english', ?)`;
    }
}

class PostgresDb extends PostgresSession {
    private readonly ready: Promise<void>;

    constructor(connectionString: string) {
        const pool = new Pool(poolConfig(connectionString));
        super(pool);
        this.ready = (async () => {
            await ensureDatabaseExists(connectionString);
            await initializeSchema(pool);
        })();
    }

    private async ensureReady(): Promise<void> {
        await this.ready;
    }

    override async get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
        const active = txContext.getStore();
        if (active) {
            return active.get<T>(sql, params);
        }
        await this.ensureReady();
        return super.get<T>(sql, params);
    }

    override async all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
        const active = txContext.getStore();
        if (active) {
            return active.all<T>(sql, params);
        }
        await this.ensureReady();
        return super.all<T>(sql, params);
    }

    override async run(sql: string, params: unknown[] = []): Promise<RunResult> {
        const active = txContext.getStore();
        if (active) {
            return active.run(sql, params);
        }
        await this.ensureReady();
        return super.run(sql, params);
    }

    override async exec(sql: string): Promise<void> {
        const active = txContext.getStore();
        if (active) {
            return active.exec(sql);
        }
        await this.ensureReady();
        return super.exec(sql);
    }

    override async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
        const active = txContext.getStore();
        if (active) {
            return active.transaction(fn);
        }
        await this.ensureReady();
        return super.transaction(fn);
    }
}

export function createPostgresDb(connectionString: string): DbClient {
    return new PostgresDb(connectionString);
}

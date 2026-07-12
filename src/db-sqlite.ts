import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { AsyncLocalStorage } from 'async_hooks';
import type { DbClient, RunResult } from './db-types.js';

const txContext = new AsyncLocalStorage<SqliteDb>();

class AsyncMutex {
    private chain: Promise<unknown> = Promise.resolve();

    run<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.chain.then(fn, fn);
        this.chain = next.then(
            () => undefined,
            () => undefined
        );
        return next;
    }
}

function ensureColumns(sqlite: Database.Database, table: string, columns: { name: string; definition: string }[]) {
    const existingColumns = new Set(
        (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
            .map(column => column.name)
    );

    for (const column of columns) {
        if (!existingColumns.has(column.name)) {
            sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.definition}`);
        }
    }
}

function initializeSchema(sqlite: Database.Database) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        rowid INTEGER PRIMARY KEY AUTOINCREMENT,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(namespace, key)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        old_snapshot TEXT,
        new_snapshot TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fact_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        version INTEGER NOT NULL,
        event TEXT NOT NULL,
        registry_channel TEXT NOT NULL,
        snapshot TEXT NOT NULL,
        author TEXT,
        change_reason TEXT,
        created_at INTEGER NOT NULL
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
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        person TEXT NOT NULL UNIQUE,
        api_key TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        namespaces TEXT NOT NULL DEFAULT '["*"]',
        scopes TEXT NOT NULL DEFAULT '["read","write"]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS registries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        owner_person TEXT NOT NULL,
        description TEXT,
        git_url TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS join_requests (
        id TEXT PRIMARY KEY,
        registry_name TEXT NOT NULL,
        person TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(registry_name, person)
      );
    `);

    ensureColumns(sqlite, 'facts', [
        { name: 'fact_type', definition: "TEXT NOT NULL DEFAULT 'entity_fact'" },
        { name: 'subject', definition: 'TEXT' },
        { name: 'scope', definition: 'TEXT' },
        { name: 'status', definition: "TEXT NOT NULL DEFAULT 'active'" },
        { name: 'derivation', definition: "TEXT NOT NULL DEFAULT 'asserted'" },
        { name: 'confidence', definition: 'REAL' },
        { name: 'source', definition: 'TEXT' },
        { name: 'evidence', definition: 'TEXT' },
        { name: 'valid_from', definition: 'INTEGER' },
        { name: 'valid_until', definition: 'INTEGER' },
        { name: 'observed_at', definition: 'INTEGER' },
        { name: 'time_period', definition: 'TEXT' },
        { name: 'audience', definition: 'TEXT' },
        { name: 'relevance_tags', definition: 'TEXT' },
        { name: 'actionability', definition: "TEXT NOT NULL DEFAULT 'informational'" },
        { name: 'owner', definition: 'TEXT' },
        { name: 'priority', definition: "TEXT NOT NULL DEFAULT 'normal'" },
        { name: 'related_facts', definition: 'TEXT' },
        { name: 'created_by', definition: 'TEXT' },
        { name: 'approved_by', definition: 'TEXT' },
        { name: 'approval_status', definition: "TEXT NOT NULL DEFAULT 'unreviewed'" },
        { name: 'registry_channel', definition: "TEXT NOT NULL DEFAULT 'working'" },
        { name: 'version', definition: 'INTEGER NOT NULL DEFAULT 1' },
        { name: 'published_at', definition: 'INTEGER' },
        { name: 'published_by', definition: 'TEXT' },
        { name: 'change_reason', definition: 'TEXT' },
        { name: 'supersedes', definition: 'TEXT' },
        { name: 'superseded_by', definition: 'TEXT' }
    ]);

    ensureColumns(sqlite, 'audit_log', [
        { name: 'old_snapshot', definition: 'TEXT' },
        { name: 'new_snapshot', definition: 'TEXT' }
    ]);

    ensureColumns(sqlite, 'api_keys', [
        { name: 'registry_name', definition: 'TEXT' }
    ]);

    sqlite.exec(`
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

    try {
        sqlite.exec(`
          DROP TRIGGER IF EXISTS facts_ai;
          DROP TRIGGER IF EXISTS facts_ad;
          DROP TRIGGER IF EXISTS facts_au;
          DROP TABLE IF EXISTS facts_fts;

          CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
            namespace,
            key,
            value,
            description,
            fact_type,
            subject,
            scope,
            status,
            derivation,
            source,
            evidence,
            time_period,
            audience,
            relevance_tags,
            actionability,
            owner,
            priority,
            created_by,
            approval_status,
            registry_channel,
            content='facts',
            content_rowid='rowid'
          );

          CREATE TRIGGER facts_ai AFTER INSERT ON facts BEGIN
            INSERT INTO facts_fts(
              rowid, namespace, key, value, description, fact_type, subject, scope,
              status, derivation, source, evidence, time_period, audience,
              relevance_tags, actionability, owner, priority, created_by, approval_status, registry_channel
            )
            VALUES (
              new.rowid, new.namespace, new.key, new.value, new.description,
              new.fact_type, new.subject, new.scope, new.status, new.derivation,
              new.source, new.evidence, new.time_period, new.audience,
              new.relevance_tags, new.actionability, new.owner, new.priority,
              new.created_by, new.approval_status, new.registry_channel
            );
          END;

          CREATE TRIGGER facts_ad AFTER DELETE ON facts BEGIN
            INSERT INTO facts_fts(
              facts_fts, rowid, namespace, key, value, description, fact_type,
              subject, scope, status, derivation, source, evidence, time_period,
              audience, relevance_tags, actionability, owner, priority, created_by,
              approval_status, registry_channel
            )
            VALUES(
              'delete', old.rowid, old.namespace, old.key, old.value,
              old.description, old.fact_type, old.subject, old.scope, old.status,
              old.derivation, old.source, old.evidence, old.time_period,
              old.audience, old.relevance_tags, old.actionability, old.owner,
              old.priority, old.created_by, old.approval_status, old.registry_channel
            );
          END;

          CREATE TRIGGER facts_au AFTER UPDATE ON facts BEGIN
            INSERT INTO facts_fts(
              facts_fts, rowid, namespace, key, value, description, fact_type,
              subject, scope, status, derivation, source, evidence, time_period,
              audience, relevance_tags, actionability, owner, priority, created_by,
              approval_status, registry_channel
            )
            VALUES(
              'delete', old.rowid, old.namespace, old.key, old.value,
              old.description, old.fact_type, old.subject, old.scope, old.status,
              old.derivation, old.source, old.evidence, old.time_period,
              old.audience, old.relevance_tags, old.actionability, old.owner,
              old.priority, old.created_by, old.approval_status, old.registry_channel
            );
            INSERT INTO facts_fts(
              rowid, namespace, key, value, description, fact_type, subject, scope,
              status, derivation, source, evidence, time_period, audience,
              relevance_tags, actionability, owner, priority, created_by, approval_status, registry_channel
            )
            VALUES (
              new.rowid, new.namespace, new.key, new.value, new.description,
              new.fact_type, new.subject, new.scope, new.status, new.derivation,
              new.source, new.evidence, new.time_period, new.audience,
              new.relevance_tags, new.actionability, new.owner, new.priority,
              new.created_by, new.approval_status, new.registry_channel
            );
          END;
        `);

        sqlite.exec("INSERT INTO facts_fts(facts_fts) VALUES('rebuild')");
    } catch (err) {
        console.error('Failed to initialize FTS5. Ensure this SQLite build supports FTS5.', err);
    }
}

class SqliteDb implements DbClient {
    readonly backend = 'sqlite' as const;
    readonly name: string;
    private readonly sqlite: Database.Database;
    private readonly mutex = new AsyncMutex();

    constructor(dbPath: string) {
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        this.name = dbPath;
        this.sqlite = new Database(dbPath);
        this.sqlite.pragma('journal_mode = WAL');
        initializeSchema(this.sqlite);
    }

    private inOwnTx(): boolean {
        return txContext.getStore() === this;
    }

    private withLock<T>(fn: () => T): Promise<T> {
        if (this.inOwnTx()) {
            return Promise.resolve(fn());
        }
        return this.mutex.run(async () => fn());
    }

    get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
        return this.withLock(() => this.sqlite.prepare(sql).get(...params) as T | undefined);
    }

    all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
        return this.withLock(() => this.sqlite.prepare(sql).all(...params) as T[]);
    }

    run(sql: string, params: unknown[] = []): Promise<RunResult> {
        return this.withLock(() => {
            const result = this.sqlite.prepare(sql).run(...params);
            return {
                changes: result.changes,
                lastInsertRowid: result.lastInsertRowid
            };
        });
    }

    exec(sql: string): Promise<void> {
        return this.withLock(() => {
            this.sqlite.exec(sql);
        });
    }

    transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
        if (this.inOwnTx()) {
            return fn(this);
        }

        return this.mutex.run(async () => {
            this.sqlite.exec('BEGIN');
            try {
                const result = await txContext.run(this, () => fn(this));
                this.sqlite.exec('COMMIT');
                return result;
            } catch (err) {
                this.sqlite.exec('ROLLBACK');
                throw err;
            }
        });
    }

    factSearchClause(): string {
        return 'rowid IN (SELECT rowid FROM facts_fts WHERE facts_fts MATCH ?)';
    }
}

export function createSqliteDb(dbPath?: string): DbClient {
    const resolved = dbPath || process.env.DATABASE_PATH || path.join(process.cwd(), 'store.db');
    return new SqliteDb(resolved);
}

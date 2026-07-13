import 'dotenv/config';
import { AsyncLocalStorage } from 'async_hooks';
import type { DbClient, DbBackendKind, RunResult } from './db-types.js';
import { createSqliteDb } from './db-sqlite.js';
import { createPostgresDb } from './db-postgres.js';

export type {
    AgentProfileRow,
    ApiKeyRow,
    AuditLogRow,
    DbBackendKind,
    DbClient,
    FactRow,
    FactVersionRow,
    JoinRequestRow,
    OpsEventRow,
    RegistryRow,
    RunResult
} from './db-types.js';

/**
 * Backend selection:
 * - DATABASE_URL set → PostgreSQL (shared origin / remote host)
 * - otherwise → SQLite at DATABASE_PATH or ./store.db
 *
 * Example (do not commit real passwords):
 * DATABASE_URL=postgresql://user:ENCODED_PASSWORD@HOST:5432/unifact?sslmode=require
 */
const databaseUrl = process.env.DATABASE_URL?.trim();

const rootDb: DbClient = databaseUrl
    ? createPostgresDb(databaseUrl)
    : createSqliteDb();

const activeDb = new AsyncLocalStorage<DbClient>();

/** Resolves the active client (transaction-local when inside db.transaction). */
export function getDb(): DbClient {
    return activeDb.getStore() ?? rootDb;
}

/**
 * Shared async DB facade used by store/api/mcp.
 * Placeholders use SQLite-style `?`; the Postgres adapter rewrites them to `$1..$n`.
 */
export const db: DbClient = {
    get backend(): DbBackendKind {
        return getDb().backend;
    },
    get name(): string {
        return getDb().name;
    },
    get<T = unknown>(sql: string, params: unknown[] = []): Promise<T | undefined> {
        return getDb().get<T>(sql, params);
    },
    all<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
        return getDb().all<T>(sql, params);
    },
    run(sql: string, params: unknown[] = []): Promise<RunResult> {
        return getDb().run(sql, params);
    },
    exec(sql: string): Promise<void> {
        return getDb().exec(sql);
    },
    async transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
        const client = getDb();
        return client.transaction(async (tx) => activeDb.run(tx, () => fn(tx)));
    },
    factSearchClause(): string {
        return getDb().factSearchClause();
    }
};

// stderr only — stdout must stay clean for MCP JSON-RPC stdio.
console.error(
    databaseUrl
        ? '[unifact] Database backend: postgres (DATABASE_URL)'
        : `[unifact] Database backend: sqlite (${rootDb.name})`
);

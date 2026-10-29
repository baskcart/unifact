import pg from 'pg';
import { parseGitHostingUrl } from './git-metadata.js';
import { requestAuthHeaders } from './keyMaterial.js';
import type { DbClient } from './db-types.js';

const { Pool } = pg;

export const CODE_GRAPHS_DDL = `
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE IF NOT EXISTS code_graphs (
  registry_name TEXT NOT NULL,
  repo TEXT NOT NULL,
  scanner TEXT NOT NULL,
  valid_at TSTZRANGE NOT NULL,
  git_ref TEXT NOT NULL,
  git_commit TEXT NOT NULL,
  graph JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  CHECK (NOT lower_inf(valid_at)),
  PRIMARY KEY (registry_name, repo, scanner, valid_at WITHOUT OVERLAPS),
  UNIQUE (registry_name, repo, scanner, git_commit)
);
`;

export interface CodeGraphRecord {
    registry_name: string;
    repo: string;
    scanner: string;
    valid_from: string;
    valid_until: string | null;
    git_ref: string;
    git_commit: string;
    observed_at: string;
    graph?: unknown;
}

export interface CodeGraphQuery {
    registry: string;
    repo?: string;
    scanner?: string;
    at?: string;
    history?: boolean;
    includeGraph?: boolean;
}

export interface ReleaseCheckout {
    branch: string | null;
    porcelain: string;
    head: string;
    releaseRef: string;
}

export class CodeGraphError extends Error {
    status: number;

    constructor(message: string, status = 400) {
        super(message);
        this.status = status;
    }
}

type SqlQuery = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

export function normalizeRepo(input: string): string {
    const parsed = parseGitHostingUrl(input);
    return parsed.url;
}

export function assertReleaseCheckout(checkout: ReleaseCheckout): void {
    const ref = checkout.releaseRef.trim();
    if (!ref) {
        throw new CodeGraphError('A release ref is required.');
    }
    if (checkout.porcelain.trim().length > 0) {
        throw new CodeGraphError('Release scan requires a clean tree.');
    }
    if (!checkout.branch || checkout.branch === 'HEAD') {
        throw new CodeGraphError(`Release scan requires branch ${ref}.`);
    }
    if (checkout.branch !== ref) {
        throw new CodeGraphError(`Release scan requires branch ${ref}. HEAD is ${checkout.branch}.`);
    }
    if (!/^[0-9a-f]{7,64}$/i.test(checkout.head.trim())) {
        throw new CodeGraphError('Release scan requires the HEAD commit.');
    }
}

export function writerUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
    const writer = env.CODE_GRAPHS_DATABASE_URL?.trim() ?? '';
    if (!writer) {
        throw new CodeGraphError(
            'Set CODE_GRAPHS_DATABASE_URL to the code_graphs writer role. The API login cannot write this table.'
        );
    }
    const api = env.DATABASE_URL?.trim();
    if (api && api === writer) {
        throw new CodeGraphError('CODE_GRAPHS_DATABASE_URL must not be the API database login.');
    }
    return writer;
}

export async function ensureCodeGraphs(query: SqlQuery): Promise<'ready' | 'created'> {
    const extension = await query(
        `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist') AS ok`
    );
    const table = await query(`SELECT to_regclass('public.code_graphs') AS name`);
    const extensionReady = extension.rows[0]?.ok === true;
    const tableReady = table.rows[0]?.name != null && String(table.rows[0].name) !== '';
    if (extensionReady && tableReady) return 'ready';
    try {
        if (!extensionReady) await query('CREATE EXTENSION IF NOT EXISTS btree_gist');
        await query(CODE_GRAPHS_DDL.replace('CREATE EXTENSION IF NOT EXISTS btree_gist;', '').trim());
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new CodeGraphError(
            `code_graphs is missing and this database login cannot create it. Apply the table as an admin, then sql/code-graphs-roles.sql. ${detail}`,
            500
        );
    }
    return 'created';
}

function iso(value: unknown): string | null {
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(String(value));
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toISOString();
}

function mapRow(row: Record<string, unknown>, includeGraph: boolean): CodeGraphRecord {
    const record: CodeGraphRecord = {
        registry_name: String(row.registry_name),
        repo: String(row.repo),
        scanner: String(row.scanner),
        valid_from: iso(row.valid_from) ?? '',
        valid_until: iso(row.valid_until),
        git_ref: String(row.git_ref),
        git_commit: String(row.git_commit),
        observed_at: iso(row.observed_at) ?? ''
    };
    if (includeGraph) record.graph = row.graph ?? null;
    return record;
}

export async function listCodeGraphs(db: DbClient, query: CodeGraphQuery): Promise<CodeGraphRecord[]> {
    if (db.backend !== 'postgres') {
        throw new CodeGraphError('Code graphs are stored on the origin Postgres. Pull them from origin.', 501);
    }
    const includeGraph = query.includeGraph === true;
    const graphColumn = includeGraph ? ', graph' : '';
    const params: unknown[] = [query.registry.trim(), query.repo?.trim() || null, query.scanner?.trim() || null];
    let timeSql = 'AND upper_inf(valid_at)';
    if (query.at) {
        timeSql = 'AND valid_at @> ?::timestamptz';
        params.push(query.at);
    } else if (query.history) {
        timeSql = '';
    }
    const rows = await db.all<Record<string, unknown>>(
        `SELECT registry_name, repo, scanner,
                lower(valid_at) AS valid_from,
                CASE WHEN upper_inf(valid_at) THEN NULL ELSE upper(valid_at) END AS valid_until,
                git_ref, git_commit, observed_at
                ${graphColumn}
         FROM code_graphs
         WHERE registry_name = ?
           AND (? IS NULL OR repo = ?)
           AND (? IS NULL OR scanner = ?)
           ${timeSql}
         ORDER BY repo, scanner, lower(valid_at)
         LIMIT 500`,
        [params[0], params[1], params[1], params[2], params[2], ...params.slice(3)]
    );
    return rows.map((row) => mapRow(row, includeGraph));
}

export interface PublishCodeGraphInput {
    registry: string;
    repo: string;
    scanner: string;
    graph: unknown;
    checkout: ReleaseCheckout;
}

export interface PublishCodeGraphResult {
    action: 'inserted' | 'unchanged';
    registry_name: string;
    repo: string;
    scanner: string;
    git_ref: string;
    git_commit: string;
    valid_from?: string;
}

function writerPoolConfig(connectionString: string): pg.PoolConfig {
    const useSsl =
        /sslmode=(require|verify-ca|verify-full)/i.test(connectionString) ||
        process.env.DATABASE_SSL === 'require';
    let cs = connectionString
        .replace(/([?&])sslmode=[^&]*/gi, '$1')
        .replace(/([?&])sslrootcert=[^&]*/gi, '$1')
        .replace(/[?&]$/, '')
        .replace(/\?&/, '?')
        .replace(/&&+/g, '&');
    if (cs.endsWith('?')) cs = cs.slice(0, -1);
    return {
        connectionString: cs,
        ssl: useSsl ? { rejectUnauthorized: false } : undefined
    };
}

function assertGraph(graph: unknown): string {
    if (graph === null || typeof graph !== 'object') {
        throw new CodeGraphError('graph must be a JSON object or array.');
    }
    return JSON.stringify(graph);
}

export async function publishCodeGraph(input: PublishCodeGraphInput): Promise<PublishCodeGraphResult> {
    assertReleaseCheckout(input.checkout);
    const connectionString = writerUrlFromEnv();
    const registry = input.registry.trim();
    const scanner = input.scanner.trim();
    const repo = normalizeRepo(input.repo);
    const commit = input.checkout.head.trim();
    const ref = input.checkout.releaseRef.trim();
    if (!registry || !scanner) {
        throw new CodeGraphError('registry and scanner are required.');
    }
    const graph = assertGraph(input.graph);
    const pool = new Pool(writerPoolConfig(connectionString));
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
            `${registry}|${repo}|${scanner}`
        ]);
        const existing = await client.query(
            `SELECT git_commit FROM code_graphs
             WHERE registry_name = $1 AND repo = $2 AND scanner = $3 AND git_commit = $4`,
            [registry, repo, scanner, commit]
        );
        if ((existing.rowCount ?? 0) > 0) {
            await client.query('COMMIT');
            return { action: 'unchanged', registry_name: registry, repo, scanner, git_ref: ref, git_commit: commit };
        }
        const open = await client.query(
            `SELECT lower(valid_at) AS valid_from
             FROM code_graphs
             WHERE registry_name = $1 AND repo = $2 AND scanner = $3 AND upper_inf(valid_at)
             FOR UPDATE`,
            [registry, repo, scanner]
        );
        const clock = await client.query(`SELECT clock_timestamp() AS ts`);
        const started = new Date(clock.rows[0]?.ts as string | Date);
        if ((open.rowCount ?? 0) > 0) {
            const openFrom = new Date(open.rows[0]?.valid_from as string | Date);
            if (openFrom.getTime() >= started.getTime()) {
                throw new CodeGraphError('The open code graph already starts at or after this scan.', 409);
            }
            await client.query(
                `UPDATE code_graphs
                 SET valid_at = tstzrange(lower(valid_at), $4::timestamptz, '[)')
                 WHERE registry_name = $1 AND repo = $2 AND scanner = $3 AND upper_inf(valid_at)`,
                [registry, repo, scanner, started]
            );
        }
        await client.query(
            `INSERT INTO code_graphs
               (registry_name, repo, scanner, valid_at, git_ref, git_commit, graph, observed_at)
             VALUES ($1, $2, $3, tstzrange($4::timestamptz, 'infinity', '[)'), $5, $6, $7::jsonb, $4::timestamptz)`,
            [registry, repo, scanner, started, ref, commit, graph]
        );
        await client.query('COMMIT');
        return {
            action: 'inserted',
            registry_name: registry,
            repo,
            scanner,
            git_ref: ref,
            git_commit: commit,
            valid_from: started.toISOString()
        };
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // The connection may already be closed.
        }
        if (err instanceof CodeGraphError) throw err;
        const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
        if (code === '23P01') {
            throw new CodeGraphError('That code graph overlaps an existing range for this repo and scanner.', 409);
        }
        if (code === '42P01') {
            throw new CodeGraphError(
                'code_graphs does not exist. Start origin once as an admin so the table is created, then apply sql/code-graphs-roles.sql.',
                500
            );
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new CodeGraphError(message, 500);
    } finally {
        client.release();
        await pool.end();
    }
}

export async function readCodeGraphs(input: {
    db: DbClient;
    query: CodeGraphQuery;
    origin?: string | null;
    apiKey?: string | null;
    privateKey?: string | null;
}): Promise<CodeGraphRecord[]> {
    if (input.db.backend === 'postgres') return listCodeGraphs(input.db, input.query);
    if (!input.origin || !input.apiKey) {
        throw new CodeGraphError('Upstream registry is not configured. Code graphs are read from origin.');
    }
    return fetchCodeGraphs({
        origin: input.origin,
        apiKey: input.apiKey,
        privateKey: input.privateKey,
        ...input.query
    });
}

export async function fetchCodeGraphs(input: {
    origin: string;
    apiKey: string;
    privateKey?: string | null;
    registry: string;
    repo?: string;
    scanner?: string;
    at?: string;
    history?: boolean;
    includeGraph?: boolean;
}): Promise<CodeGraphRecord[]> {
    const url = new URL(
        `${input.origin.replace(/\/$/, '')}/v1/registries/${encodeURIComponent(input.registry)}/code-graphs`
    );
    if (input.repo) url.searchParams.set('repo', input.repo);
    if (input.scanner) url.searchParams.set('scanner', input.scanner);
    if (input.at) url.searchParams.set('at', input.at);
    if (input.history) url.searchParams.set('history', 'true');
    if (input.includeGraph) url.searchParams.set('include_graph', 'true');
    const response = await fetch(url, {
        headers: requestAuthHeaders({
            secret: input.apiKey,
            privateKey: input.privateKey,
            method: 'GET',
            url: url.toString()
        })
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string; graphs?: CodeGraphRecord[] };
    if (!response.ok) {
        throw new CodeGraphError(body.error || `Origin returned ${response.status}`, response.status);
    }
    return Array.isArray(body.graphs) ? body.graphs : [];
}

/**
 * Org-scoped ops event counters (errors / calls).
 * Not facts — adjacent Postgres/SQLite table for ops agents.
 */
import { db, type OpsEventRow } from './db.js';

export type OpsEventKind = 'error' | 'call';

export interface OpsEventRecord {
    id: number;
    registry_name: string;
    kind: OpsEventKind;
    event_code: string;
    event_count: number;
    first_seen: number;
    last_seen: number;
    label: string;
    extra_context: string | null;
    env: string | null;
    source: string | null;
}

export interface TrackOpsEventInput {
    registry_name: string;
    kind: OpsEventKind;
    event_code: string;
    label: string;
    extra_context?: string | null;
    env?: string | null;
    source?: string | null;
}

/** Reserved bucket for pre-org / platform emitters (not a real registry row). */
export const OPS_PLATFORM_REGISTRY = '_platform';

export function normalizeOpsRegistryName(name: string): string {
    const cleaned = name.trim().toLowerCase();
    if (!cleaned) {
        throw Object.assign(new Error('registry_name is required'), { status: 400 });
    }
    if (cleaned === OPS_PLATFORM_REGISTRY) return OPS_PLATFORM_REGISTRY;
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(cleaned)) {
        throw Object.assign(
            new Error('registry_name must be 1–64 chars: letters, numbers, . _ - (or _platform)'),
            { status: 400 }
        );
    }
    return cleaned;
}

export function normalizeOpsEventCode(code: string): string {
    const s = code
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 64);
    if (!s) {
        throw Object.assign(new Error('event_code is required'), { status: 400 });
    }
    return s;
}

function toRecord(row: OpsEventRow): OpsEventRecord {
    const kind = row.kind === 'call' ? 'call' : 'error';
    return {
        id: Number(row.id),
        registry_name: row.registry_name,
        kind,
        event_code: row.event_code,
        event_count: Number(row.event_count),
        first_seen: Number(row.first_seen),
        last_seen: Number(row.last_seen),
        label: row.label,
        extra_context: row.extra_context,
        env: row.env,
        source: row.source
    };
}

export async function trackOpsEvent(input: TrackOpsEventInput): Promise<OpsEventRecord> {
    const registry_name = normalizeOpsRegistryName(input.registry_name);
    const kind: OpsEventKind = input.kind === 'call' ? 'call' : 'error';
    const event_code = normalizeOpsEventCode(input.event_code);
    const label = (input.label || event_code).slice(0, 240);
    const extra_context = input.extra_context?.slice(0, 500) ?? null;
    const env = input.env?.slice(0, 64) ?? null;
    const source = input.source?.slice(0, 64) ?? null;
    const now = Date.now();

    await db.run(
        `INSERT INTO ops_events (
           registry_name, kind, event_code, event_count, first_seen, last_seen,
           label, extra_context, env, source
         ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(registry_name, kind, event_code) DO UPDATE SET
           event_count = ops_events.event_count + 1,
           last_seen = excluded.last_seen,
           extra_context = COALESCE(excluded.extra_context, ops_events.extra_context),
           env = COALESCE(excluded.env, ops_events.env),
           source = COALESCE(excluded.source, ops_events.source)`,
        [registry_name, kind, event_code, now, now, label, extra_context, env, source]
    );

    const row = await db.get<OpsEventRow>(
        `SELECT * FROM ops_events WHERE registry_name = ? AND kind = ? AND event_code = ?`,
        [registry_name, kind, event_code]
    );
    if (!row) {
        throw new Error('ops_events upsert succeeded but row missing');
    }
    return toRecord(row);
}

export async function listOpsEvents(options: {
    registry_name?: string;
    kind?: OpsEventKind;
    limit?: number;
}): Promise<OpsEventRecord[]> {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options.registry_name) {
        clauses.push('registry_name = ?');
        params.push(normalizeOpsRegistryName(options.registry_name));
    }
    if (options.kind === 'error' || options.kind === 'call') {
        clauses.push('kind = ?');
        params.push(options.kind);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);

    const rows = await db.all<OpsEventRow>(
        `SELECT * FROM ops_events ${where} ORDER BY last_seen DESC LIMIT ?`,
        params
    );
    return rows.map(toRecord);
}

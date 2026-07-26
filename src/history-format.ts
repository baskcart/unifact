import type { AuditLogRow } from './db.js';
import type { FactVersionResponse } from './model.js';

export function truncateHistoryValue(value: unknown, max = 72): string {
    if (value == null || value === '') return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

export function valueFromSnapshot(snapshot: unknown): string {
    if (!snapshot || typeof snapshot !== 'object') return '';
    if (!('value' in snapshot)) return '';
    const value = (snapshot as { value: unknown }).value;
    return truncateHistoryValue(value);
}

/** Compact lifecycle lines, oldest version first. */
export function formatHistoryVersionLines(versions: FactVersionResponse[]): string[] {
    const sorted = [...versions].sort((a, b) => a.version - b.version || a.id - b.id);
    return sorted.map((v) => {
        const iso = new Date(v.created_at).toISOString();
        const author = v.author || '—';
        const value = valueFromSnapshot(v.snapshot);
        const tail = value ? `  ${value}` : '';
        return `v${v.version}  ${v.event.padEnd(9)} ${author.padEnd(14)} ${iso}${tail}`;
    });
}

/** Compact audit diffs (newest first). Snapshots only when verbose. */
export function formatHistoryAuditLines(rows: AuditLogRow[], verbose = false): string[] {
    return rows.map((row) => {
        const iso = new Date(row.timestamp).toISOString();
        const actor = row.actor || '—';
        const oldV = truncateHistoryValue(row.old_value) || '∅';
        const newV = truncateHistoryValue(row.new_value) || '∅';
        let line = `${actor.padEnd(14)} ${iso}  ${row.action.padEnd(8)}  ${oldV} → ${newV}`;
        if (verbose) {
            const oldSnap = truncateHistoryValue(row.old_snapshot, 120);
            const newSnap = truncateHistoryValue(row.new_snapshot, 120);
            if (oldSnap || newSnap) {
                line += `\n    snapshots: ${oldSnap || '∅'} → ${newSnap || '∅'}`;
            }
        }
        return line;
    });
}

/** Strip bulky snapshots unless verbose (for JSON / MCP). */
export function compactAuditRows(rows: AuditLogRow[], verbose = false): unknown[] {
    if (verbose) return rows;
    return rows.map(({ old_snapshot: _o, new_snapshot: _n, ...rest }) => rest);
}

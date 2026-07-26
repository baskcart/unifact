import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    compactAuditRows,
    formatHistoryAuditLines,
    formatHistoryVersionLines,
    truncateHistoryValue,
    valueFromSnapshot
} from './history-format.js';
import type { FactVersionResponse } from './model.js';
import type { AuditLogRow } from './db.js';

describe('truncateHistoryValue', () => {
    it('collapses whitespace and truncates', () => {
        assert.equal(truncateHistoryValue('  a   b  '), 'a b');
        assert.equal(truncateHistoryValue('x'.repeat(80)).endsWith('…'), true);
    });
});

describe('valueFromSnapshot', () => {
    it('reads fact value', () => {
        assert.equal(valueFromSnapshot({ value: 'https://www.unifact.ai' }), 'https://www.unifact.ai');
        assert.equal(valueFromSnapshot(null), '');
    });
});

describe('formatHistoryVersionLines', () => {
    it('prints oldest-first compact lifecycle lines', () => {
        const versions: FactVersionResponse[] = [
            {
                id: 3,
                registry_name: 'Unifact',
                namespace: 'company.infrastructure',
                key: 'auth-url',
                version: 3,
                event: 'publish',
                registry_channel: 'published',
                snapshot: { value: 'https://www.unifact.ai' },
                author: 'founder',
                change_reason: null,
                created_at: Date.parse('2026-01-02T00:00:00.000Z')
            },
            {
                id: 1,
                registry_name: 'Unifact',
                namespace: 'company.infrastructure',
                key: 'auth-url',
                version: 1,
                event: 'propose',
                registry_channel: 'proposed',
                snapshot: { value: 'draft' },
                author: 'builder-agent',
                change_reason: null,
                created_at: Date.parse('2026-01-01T00:00:00.000Z')
            }
        ];
        const lines = formatHistoryVersionLines(versions);
        assert.equal(lines.length, 2);
        assert.match(lines[0], /^v1  propose\s+builder-agent/);
        assert.match(lines[1], /^v3  publish\s+founder/);
        assert.ok(lines[1].includes('https://www.unifact.ai'));
    });
});

describe('formatHistoryAuditLines', () => {
    it('prints actor / action / old→new', () => {
        const rows: AuditLogRow[] = [
            {
                id: 1,
                action: 'UPDATE',
                registry_name: 'Unifact',
                namespace: 'ns',
                key: 'k',
                old_value: 'a',
                new_value: 'b',
                old_snapshot: '{"value":"a"}',
                new_snapshot: '{"value":"b"}',
                actor: 'alice',
                timestamp: Date.parse('2026-01-01T12:00:00.000Z')
            }
        ];
        const lines = formatHistoryAuditLines(rows);
        assert.equal(lines.length, 1);
        assert.ok(lines[0].includes('alice'));
        assert.ok(lines[0].includes('UPDATE'));
        assert.ok(lines[0].includes('a → b'));
        assert.equal(lines[0].includes('snapshots:'), false);

        const verbose = formatHistoryAuditLines(rows, true);
        assert.ok(verbose[0].includes('snapshots:'));
    });
});

describe('compactAuditRows', () => {
    it('omits snapshots unless verbose', () => {
        const rows: AuditLogRow[] = [
            {
                id: 1,
                action: 'CREATE',
                namespace: 'ns',
                key: 'k',
                old_value: null,
                new_value: 'x',
                old_snapshot: null,
                new_snapshot: '{}',
                actor: 'bob',
                timestamp: 1
            }
        ];
        const compact = compactAuditRows(rows) as Array<Record<string, unknown>>;
        assert.equal('old_snapshot' in compact[0], false);
        assert.equal('new_snapshot' in compact[0], false);
        assert.equal(compactAuditRows(rows, true), rows);
    });
});

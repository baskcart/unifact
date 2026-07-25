import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    actorFromFactSnapshot,
    buildFactAsOfResult,
    parseAsOfTimestamp,
    pickAsOfArg,
    selectVersionAsOf
} from './as-of.js';

describe('parseAsOfTimestamp', () => {
    it('accepts unix ms and ISO', () => {
        assert.equal(parseAsOfTimestamp(1_700_000_000_000), 1_700_000_000_000);
        assert.equal(parseAsOfTimestamp('2024-01-15T12:00:00.000Z'), Date.parse('2024-01-15T12:00:00.000Z'));
    });
});

describe('pickAsOfArg', () => {
    it('prefers as_of over at', () => {
        assert.equal(pickAsOfArg({ as_of: '2026-01-01T00:00:00Z', at: 1 }), '2026-01-01T00:00:00Z');
        assert.equal(pickAsOfArg({ at: 99 }), 99);
        assert.equal(pickAsOfArg({ as_of: '', at: 99 }), 99);
        assert.equal(pickAsOfArg({}), undefined);
    });
});

describe('selectVersionAsOf', () => {
    const versions = [
        {
            id: 1,
            created_at: 100,
            registry_channel: 'proposed',
            snapshot: { value: 'draft' }
        },
        {
            id: 2,
            created_at: 200,
            registry_channel: 'published',
            snapshot: { value: 'v1', registry_channel: 'published' }
        },
        {
            id: 3,
            created_at: 300,
            registry_channel: 'published',
            snapshot: { value: 'v2', registry_channel: 'published' }
        },
        {
            id: 4,
            created_at: 400,
            registry_channel: 'retracted',
            snapshot: { value: 'v2', registry_channel: 'retracted' }
        }
    ];

    it('returns null before first publish', () => {
        assert.equal(selectVersionAsOf(versions, 150), null);
    });

    it('returns published snapshot at T', () => {
        const at200 = selectVersionAsOf(versions, 200);
        assert.equal(at200?.id, 2);
        assert.equal((at200?.snapshot as { value: string }).value, 'v1');

        const at350 = selectVersionAsOf(versions, 350);
        assert.equal(at350?.id, 3);
        assert.equal((at350?.snapshot as { value: string }).value, 'v2');
    });

    it('returns retracted state when retract <= T', () => {
        const at500 = selectVersionAsOf(versions, 500);
        assert.equal(at500?.registry_channel, 'retracted');
        assert.equal(at500?.id, 4);
    });
});

describe('buildFactAsOfResult', () => {
    it('sets as_of_status none when never published', () => {
        const result = buildFactAsOfResult(
            [{ id: 1, created_at: 10, registry_channel: 'proposed', snapshot: { value: 'x' } }],
            100
        );
        assert.equal(result.found, false);
        assert.equal(result.as_of_status, 'none');
        assert.equal(result.fact, null);
    });

    it('returns fact snapshot when published', () => {
        const result = buildFactAsOfResult(
            [
                {
                    id: 9,
                    created_at: 50,
                    registry_channel: 'published',
                    version: 2,
                    event: 'publish',
                    author: 'alice',
                    snapshot: {
                        namespace: 'policy',
                        key: 'return_window',
                        value: '30 days',
                        registry_channel: 'published'
                    }
                }
            ],
            '1970-01-01T00:00:00.100Z',
            { registry_name: 'Demo', namespace: 'policy', key: 'return_window' }
        );
        assert.equal(result.found, true);
        assert.equal(result.as_of_status, 'published');
        assert.equal(result.fact?.value, '30 days');
        assert.equal(result.version?.author, 'alice');
    });
});

describe('actorFromFactSnapshot', () => {
    it('prefers published_by then approved_by then created_by', () => {
        assert.equal(
            actorFromFactSnapshot({ published_by: 'p', approved_by: 'a', created_by: 'c' }),
            'p'
        );
        assert.equal(actorFromFactSnapshot({ approved_by: 'a', created_by: 'c' }), 'a');
        assert.equal(actorFromFactSnapshot({ created_by: 'c' }), 'c');
        assert.equal(actorFromFactSnapshot({}), null);
    });
});

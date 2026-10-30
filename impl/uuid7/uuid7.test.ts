import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generate, parts } from './uuid7.ts';

function variant(id: string): number {
    const hex = id.replace(/-/g, '');
    return Number.parseInt(hex.slice(16, 18), 16) & 0xc0;
}

describe('uuid7', () => {
    it('sets version 7, the RFC variant, and a current timestamp', () => {
        const before = Date.now();
        const id = generate();
        const after = Date.now();
        const piece = parts(id);
        assert.equal(piece.version, 7);
        assert.equal(variant(id), 0x80);
        assert.ok(piece.timestamp >= before && piece.timestamp <= after);
        assert.equal(piece.random.length, 20);
    });

    it('keeps a thousand calls unique and ordered across milliseconds', async () => {
        const ids = new Set<string>();
        for (let i = 0; i < 1000; i++) ids.add(generate());
        assert.equal(ids.size, 1000);
        const first = generate();
        await new Promise((resolve) => setTimeout(resolve, 5));
        const second = generate();
        assert.ok(parts(second).timestamp >= parts(first).timestamp);
        assert.deepEqual([first, second].sort(), [first, second]);
    });
});

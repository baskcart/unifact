import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { namespaceChain, parentNamespaces } from '../src/namespaces.js';
import { topLevelName } from '../src/naming.js';

describe('namespaceChain', () => {
    it('walks dotted hierarchy from specific to root', () => {
        assert.deepEqual(namespaceChain('baskcart.sales.policy'), [
            'baskcart.sales.policy',
            'baskcart.sales',
            'baskcart'
        ]);
    });

    it('returns single segment as-is', () => {
        assert.deepEqual(namespaceChain('company'), ['company']);
    });
});

describe('parentNamespaces', () => {
    it('excludes self', () => {
        assert.deepEqual(parentNamespaces('sales.west.policy'), ['sales.west', 'sales']);
    });
});

describe('topLevelName', () => {
    it('returns first segment', () => {
        assert.equal(topLevelName('baskcart.sales.policy'), 'baskcart');
        assert.equal(topLevelName('Unifact'), 'Unifact');
    });
});

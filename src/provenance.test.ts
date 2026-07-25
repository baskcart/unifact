import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    checkProvenance,
    evidenceIsPresent,
    getProvenancePolicy,
    namespaceMatchesPatterns,
    provenanceRequiredForNamespace
} from './provenance.js';

describe('namespaceMatchesPatterns', () => {
    it('matches exact, prefix.*, and *', () => {
        assert.equal(namespaceMatchesPatterns('policy', ['policy']), true);
        assert.equal(namespaceMatchesPatterns('company.constraints', ['company.*']), true);
        assert.equal(namespaceMatchesPatterns('company', ['company.*']), true);
        assert.equal(namespaceMatchesPatterns('other', ['company.*']), false);
        assert.equal(namespaceMatchesPatterns('anything', ['*']), true);
    });
});

describe('getProvenancePolicy', () => {
    it('reads require-all and namespace list from env', () => {
        const all = getProvenancePolicy({
            UNIFACT_REQUIRE_PROVENANCE: '1'
        } as NodeJS.ProcessEnv);
        assert.equal(all.requireAll, true);
        assert.equal(provenanceRequiredForNamespace('any.ns', all), true);

        const listed = getProvenancePolicy({
            UNIFACT_REQUIRE_PROVENANCE_NAMESPACES: 'policy,company.constraints'
        } as NodeJS.ProcessEnv);
        assert.equal(listed.requireAll, false);
        assert.equal(provenanceRequiredForNamespace('policy', listed), true);
        assert.equal(provenanceRequiredForNamespace('company.branding', listed), false);
    });
});

describe('evidenceIsPresent', () => {
    it('accepts structured evidence shapes', () => {
        assert.equal(evidenceIsPresent(null), false);
        assert.equal(evidenceIsPresent(''), false);
        assert.equal(evidenceIsPresent('ticket://ABC'), true);
        assert.equal(evidenceIsPresent({ url: 'https://example.com/doc' }), true);
        assert.equal(evidenceIsPresent({ ticket: 'UF-1' }), true);
        assert.equal(evidenceIsPresent({ conversation_id: 'chat-9' }), true);
        assert.equal(evidenceIsPresent({ refs: ['a'] }), true);
        assert.equal(evidenceIsPresent({}), false);
    });
});

describe('checkProvenance', () => {
    it('blocks missing source when required', () => {
        const policy = getProvenancePolicy({
            UNIFACT_REQUIRE_PROVENANCE_NAMESPACES: 'policy',
            UNIFACT_PROVENANCE_MODE: 'block'
        } as NodeJS.ProcessEnv);
        const bad = checkProvenance({ namespace: 'policy', source: null }, policy);
        assert.equal(bad.ok, false);
        assert.ok(bad.errors.some((e) => e.includes('source')));

        const good = checkProvenance(
            { namespace: 'policy', source: 'founder-decision', evidence: { ticket: 'UF-1' } },
            policy
        );
        assert.equal(good.ok, true);
    });

    it('warn mode softens errors to warnings', () => {
        const policy = getProvenancePolicy({
            UNIFACT_REQUIRE_PROVENANCE: 'true',
            UNIFACT_PROVENANCE_MODE: 'warn'
        } as NodeJS.ProcessEnv);
        const result = checkProvenance({ namespace: 'x', source: '' }, policy);
        assert.equal(result.ok, true);
        assert.ok(result.warnings.length > 0);
    });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FactResponse } from './model.js';
import {
    conceptIdForFact,
    factToOkfConcept,
    filterFactsForOkfExport,
    okfConceptToProposePayload,
    parseOkfDocument,
    serializeOkfConcept,
    factTypeToOkfType,
    okfTypeToFactType
} from './okf.js';

function sampleFact(overrides: Partial<FactResponse> = {}): FactResponse {
    return {
        registry_name: 'Unifact',
        namespace: 'company.policy',
        key: 'return_window',
        value: '30 days from delivery for unused items.',
        description: 'Customer return window',
        fact_type: 'constraint_fact',
        subject: 'returns',
        scope: 'customer',
        status: 'active',
        derivation: 'asserted',
        confidence: 0.9,
        source: 'founder-decision',
        evidence: { url: 'https://example.com/policy' },
        valid_from: null,
        valid_until: null,
        observed_at: null,
        time_period: null,
        audience: [],
        relevance_tags: ['returns', 'policy'],
        actionability: 'constraint',
        owner: null,
        priority: 'high',
        related_facts: [],
        created_by: 'admin',
        approved_by: 'admin',
        approval_status: 'approved',
        registry_channel: 'published',
        version: 2,
        published_at: 1700000000000,
        published_by: 'admin',
        change_reason: null,
        supersedes: null,
        superseded_by: null,
        created_at: 1700000000000,
        updated_at: 1700000000000,
        ...overrides
    };
}

describe('OKF type mapping', () => {
    it('maps fact types to OKF concept types', () => {
        assert.equal(factTypeToOkfType('constraint_fact'), 'Policy');
        assert.equal(factTypeToOkfType('decision_fact'), 'Decision');
        assert.equal(factTypeToOkfType('unknown'), 'UniFact');
        assert.equal(okfTypeToFactType('Policy'), 'constraint_fact');
        assert.equal(okfTypeToFactType('Decision'), 'decision_fact');
    });
});

describe('factToOkfConcept + serialize/parse', () => {
    it('round-trips published fact through markdown', () => {
        const concept = factToOkfConcept(sampleFact());
        assert.equal(concept.conceptId, 'unifact/company.policy/return_window');
        assert.equal(concept.frontmatter.type, 'Policy');
        assert.equal(concept.frontmatter.unifact?.namespace, 'company.policy');
        assert.equal(concept.frontmatter.verified, 'human:admin');
        assert.ok(concept.body.includes('30 days'));

        const md = serializeOkfConcept(concept);
        assert.match(md, /^---\n/);
        assert.match(md, /type: Policy/);

        const parsed = parseOkfDocument(md, concept.conceptId);
        assert.equal(parsed.frontmatter.type, 'Policy');
        assert.equal(parsed.frontmatter.unifact?.key, 'return_window');
        assert.equal(parsed.body.trim(), '30 days from delivery for unused items.');
    });

    it('builds concept id from namespace/key', () => {
        assert.equal(conceptIdForFact('a.b', 'c'), 'unifact/a.b/c');
    });
});

describe('okfConceptToProposePayload', () => {
    it('proposes only and never published channel', () => {
        const concept = factToOkfConcept(sampleFact());
        const payload = okfConceptToProposePayload(concept, { createdBy: 'importer' });
        assert.ok(payload);
        assert.equal(payload!.registry_channel, 'proposed');
        assert.equal(payload!.approval_status, 'pending');
        assert.equal(payload!.namespace, 'company.policy');
        assert.equal(payload!.key, 'return_window');
        assert.equal(payload!.fact_type, 'constraint_fact');
        assert.equal(payload!.created_by, 'importer');
        assert.equal((payload!.evidence as { format: string }).format, 'okf');
    });

    it('skips non-importable types', () => {
        const concept = factToOkfConcept(sampleFact());
        concept.frontmatter.type = 'BigQuery Table';
        assert.equal(okfConceptToProposePayload(concept), null);
    });

    it('parses stand-alone Policy without unifact block', () => {
        const md = `---
type: Policy
title: Shipping cutoff
description: Warehouse cutoff time
tags:
  - logistics
---

Orders placed after 2pm ship next business day.
`;
        const concept = parseOkfDocument(md, 'policy/shipping_cutoff');
        const payload = okfConceptToProposePayload(concept, { defaultNamespace: 'company.policy' });
        assert.ok(payload);
        assert.equal(payload!.fact_type, 'constraint_fact');
        assert.equal(payload!.registry_channel, 'proposed');
        assert.match(payload!.value, /2pm/);
    });
});

describe('filterFactsForOkfExport', () => {
    it('defaults to published only', () => {
        const facts = [
            sampleFact({ key: 'a', registry_channel: 'published' }),
            sampleFact({ key: 'b', registry_channel: 'proposed' })
        ];
        const out = filterFactsForOkfExport(facts);
        assert.equal(out.length, 1);
        assert.equal(out[0].key, 'a');
    });

    it('filters namespaces', () => {
        const facts = [
            sampleFact({ namespace: 'company.policy', key: 'a' }),
            sampleFact({ namespace: 'company.branding', key: 'b' })
        ];
        const out = filterFactsForOkfExport(facts, { namespaces: ['company.branding'] });
        assert.equal(out.length, 1);
        assert.equal(out[0].key, 'b');
    });
});

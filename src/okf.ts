/**
 * Open Knowledge Format (OKF) ↔ UniFact mapping.
 *
 * OKF is a portable markdown+YAML knowledge bundle (Google Cloud open spec).
 * UniFact is the governed registry. This module converts published facts to
 * OKF concepts and OKF concepts back to propose-only upsert payloads.
 *
 * Spec reference: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/HEAD/okf/SPEC.md
 */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { FactResponse, FactType } from './model.js';
import { FACT_TYPES } from './model.js';

export const OKF_UNIFACT_TYPE = 'UniFact';
export const OKF_BUNDLE_FORMAT = 'okf';
export const OKF_BUNDLE_VERSION = '0.2';

/** OKF concept types we import into UniFact (propose only). */
export const OKF_IMPORTABLE_TYPES = new Set([
    'UniFact',
    'Policy',
    'Decision',
    'Constraint',
    'Preference',
    'Entity',
    'State',
    'Insight',
    'Actionable',
    'Playbook'
]);

const FACT_TYPE_TO_OKF: Record<string, string> = {
    decision_fact: 'Decision',
    constraint_fact: 'Policy',
    preference_fact: 'Preference',
    entity_fact: 'Entity',
    state_fact: 'State',
    insight_fact: 'Insight',
    actionable_fact: 'Actionable'
};

const OKF_TYPE_TO_FACT: Record<string, FactType> = {
    UniFact: 'entity_fact',
    Policy: 'constraint_fact',
    Decision: 'decision_fact',
    Constraint: 'constraint_fact',
    Preference: 'preference_fact',
    Entity: 'entity_fact',
    State: 'state_fact',
    Insight: 'insight_fact',
    Actionable: 'actionable_fact',
    Playbook: 'constraint_fact'
};

export interface OkfSource {
    name?: string;
    resource?: string;
    author?: string;
    [key: string]: unknown;
}

export interface OkfUnifactMeta {
    namespace: string;
    key: string;
    registry?: string;
    registry_channel?: string;
    fact_type?: string;
    subject?: string | null;
    scope?: string | null;
    actionability?: string | null;
    owner?: string | null;
    priority?: string | null;
    confidence?: number | null;
    related_facts?: string[];
    version?: number;
}

export interface OkfFrontmatter {
    type: string;
    title?: string;
    description?: string;
    tags?: string[];
    sources?: OkfSource[];
    verified?: string | string[] | Record<string, unknown>;
    unifact?: OkfUnifactMeta;
    stale_after?: string | number;
    [key: string]: unknown;
}

export interface OkfConcept {
    /** Path relative to bundle root, without .md (OKF concept ID). */
    conceptId: string;
    frontmatter: OkfFrontmatter;
    body: string;
}

export interface OkfProposePayload {
    namespace: string;
    key: string;
    value: string;
    description: string | null;
    fact_type: FactType;
    subject: string | null;
    scope: string | null;
    source: string;
    evidence: Record<string, unknown>;
    created_by: string | null;
    confidence: number | null;
    relevance_tags: string[];
    related_facts: string[];
    actionability: string | null;
    owner: string | null;
    priority: string | null;
    registry_channel: 'proposed';
    approval_status: 'pending';
    change_reason: string;
}

export function factTypeToOkfType(factType: string | null | undefined): string {
    if (!factType) return OKF_UNIFACT_TYPE;
    return FACT_TYPE_TO_OKF[factType] || OKF_UNIFACT_TYPE;
}

export function okfTypeToFactType(okfType: string): FactType {
    return OKF_TYPE_TO_FACT[okfType] || 'entity_fact';
}

export function conceptIdForFact(namespace: string, key: string): string {
    return `unifact/${namespace}/${key}`;
}

export function relativePathForConceptId(conceptId: string): string {
    return `${conceptId}.md`.replace(/\\/g, '/');
}

function actorVerified(fact: FactResponse): string | undefined {
    if (fact.approved_by) return `human:${fact.approved_by}`;
    if (fact.published_by) return `human:${fact.published_by}`;
    if (fact.created_by) {
        const by = fact.created_by;
        if (by.startsWith('human:') || by.startsWith('agent:') || by.startsWith('process:')) {
            return by;
        }
        if (/agent|uni|cursor|claude|copilot/i.test(by)) return `agent:${by}`;
        return `human:${by}`;
    }
    return undefined;
}

function sourcesFromFact(fact: FactResponse): OkfSource[] {
    const sources: OkfSource[] = [];
    if (fact.source) {
        sources.push({
            name: fact.source,
            resource: fact.source.startsWith('http') ? fact.source : `unifact-source:${fact.source}`
        });
    }
    if (fact.evidence && typeof fact.evidence === 'object' && !Array.isArray(fact.evidence)) {
        const ev = fact.evidence as Record<string, unknown>;
        if (typeof ev.url === 'string') {
            sources.push({ name: 'evidence.url', resource: ev.url });
        }
        if (typeof ev.ticket === 'string') {
            sources.push({ name: 'evidence.ticket', resource: String(ev.ticket) });
        }
        if (typeof ev.conversation_id === 'string') {
            sources.push({ name: 'evidence.conversation_id', resource: String(ev.conversation_id) });
        }
    } else if (typeof fact.evidence === 'string' && fact.evidence.trim()) {
        sources.push({ name: 'evidence', resource: fact.evidence.trim() });
    }
    return sources;
}

/** Map a UniFact row to an OKF concept (export). */
export function factToOkfConcept(fact: FactResponse): OkfConcept {
    const conceptId = conceptIdForFact(fact.namespace, fact.key);
    const okfType = factTypeToOkfType(fact.fact_type);
    const verified = actorVerified(fact);
    const sources = sourcesFromFact(fact);
    const frontmatter: OkfFrontmatter = {
        type: okfType,
        title: fact.description?.trim() || `${fact.namespace}/${fact.key}`,
        description: fact.description || undefined,
        tags: fact.relevance_tags?.length ? [...fact.relevance_tags] : undefined,
        unifact: {
            namespace: fact.namespace,
            key: fact.key,
            registry: fact.registry_name,
            registry_channel: fact.registry_channel,
            fact_type: fact.fact_type,
            subject: fact.subject,
            scope: fact.scope,
            actionability: fact.actionability,
            owner: fact.owner,
            priority: fact.priority,
            confidence: fact.confidence,
            related_facts: fact.related_facts?.length ? [...fact.related_facts] : undefined,
            version: fact.version
        }
    };
    if (sources.length) frontmatter.sources = sources;
    if (verified) frontmatter.verified = verified;
    if (fact.valid_until != null) {
        frontmatter.stale_after = new Date(fact.valid_until).toISOString();
    }

    return {
        conceptId,
        frontmatter,
        body: String(fact.value ?? '').trimEnd() + '\n'
    };
}

/** Serialize concept to markdown with YAML frontmatter. */
export function serializeOkfConcept(concept: OkfConcept): string {
    const fm = { ...concept.frontmatter };
    // Drop undefined nested empties for cleaner files
    if (fm.tags && fm.tags.length === 0) delete fm.tags;
    if (fm.sources && fm.sources.length === 0) delete fm.sources;
    if (fm.unifact) {
        const u = { ...fm.unifact };
        for (const [k, v] of Object.entries(u)) {
            if (v == null || (Array.isArray(v) && v.length === 0)) {
                delete (u as Record<string, unknown>)[k];
            }
        }
        fm.unifact = u;
    }
    const yaml = stringifyYaml(fm, { lineWidth: 0 }).trimEnd();
    const body = concept.body.replace(/^\n+/, '');
    return `---\n${yaml}\n---\n\n${body.endsWith('\n') ? body : `${body}\n`}`;
}

export function parseOkfDocument(markdown: string, conceptIdHint?: string): OkfConcept {
    const text = markdown.replace(/^\uFEFF/, '');
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) {
        throw new Error('OKF concept must start with YAML frontmatter delimited by ---');
    }
    const raw = parseYaml(match[1]);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('OKF frontmatter must be a YAML mapping');
    }
    const frontmatter = raw as OkfFrontmatter;
    if (!frontmatter.type || typeof frontmatter.type !== 'string') {
        throw new Error('OKF frontmatter requires type: <string>');
    }
    const body = (match[2] || '').replace(/^\n/, '');
    const conceptId =
        conceptIdHint ||
        (frontmatter.unifact?.namespace && frontmatter.unifact?.key
            ? conceptIdForFact(frontmatter.unifact.namespace, frontmatter.unifact.key)
            : 'imported/unknown');
    return { conceptId, frontmatter, body };
}

function sanitizeSegment(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 120) || 'item';
}

function namespaceKeyFromConcept(concept: OkfConcept, defaultNamespace: string): { namespace: string; key: string } {
    const u = concept.frontmatter.unifact;
    if (u?.namespace && u?.key) {
        return { namespace: String(u.namespace), key: String(u.key) };
    }
    // conceptId: unifact/ns/key or folder/name
    const parts = concept.conceptId.split('/').filter(Boolean);
    if (parts[0] === 'unifact' && parts.length >= 3) {
        return {
            namespace: parts.slice(1, -1).join('.') || defaultNamespace,
            key: sanitizeSegment(parts[parts.length - 1])
        };
    }
    if (parts.length >= 2) {
        return {
            namespace: sanitizeSegment(parts[0]).replace(/_/g, '.') || defaultNamespace,
            key: sanitizeSegment(parts[parts.length - 1])
        };
    }
    const title = concept.frontmatter.title || concept.conceptId;
    return {
        namespace: defaultNamespace,
        key: sanitizeSegment(String(title))
    };
}

function evidenceFromOkf(concept: OkfConcept): Record<string, unknown> {
    const evidence: Record<string, unknown> = {
        format: OKF_BUNDLE_FORMAT,
        concept_id: concept.conceptId,
        okf_type: concept.frontmatter.type
    };
    const sources = concept.frontmatter.sources;
    if (Array.isArray(sources) && sources.length) {
        const urls = sources.map((s) => s.resource).filter((r): r is string => typeof r === 'string' && /^https?:/i.test(r));
        if (urls[0]) evidence.url = urls[0];
        evidence.refs = sources.map((s) => s.resource || s.name).filter(Boolean);
    }
    evidence.note = `Imported from OKF concept ${concept.conceptId}`;
    return evidence;
}

function createdByFromVerified(verified: OkfFrontmatter['verified']): string | null {
    if (typeof verified === 'string' && verified.trim()) {
        const v = verified.trim();
        if (v.startsWith('human:') || v.startsWith('agent:') || v.startsWith('process:')) {
            return v.slice(v.indexOf(':') + 1);
        }
        return v;
    }
    return null;
}

/** Convert an OKF concept into a propose-only UniFact upsert payload. */
export function okfConceptToProposePayload(
    concept: OkfConcept,
    options?: { defaultNamespace?: string; createdBy?: string | null }
): OkfProposePayload | null {
    if (!OKF_IMPORTABLE_TYPES.has(concept.frontmatter.type)) {
        return null;
    }
    const defaultNamespace = options?.defaultNamespace || 'company.imported';
    const { namespace, key } = namespaceKeyFromConcept(concept, defaultNamespace);
    const value = concept.body.trim();
    if (!value) return null;

    const u = concept.frontmatter.unifact;
    const factType =
        u?.fact_type && (FACT_TYPES as readonly string[]).includes(u.fact_type)
            ? (u.fact_type as FactType)
            : okfTypeToFactType(concept.frontmatter.type);

    const sourceName =
        Array.isArray(concept.frontmatter.sources) && concept.frontmatter.sources[0]?.name
            ? String(concept.frontmatter.sources[0].name)
            : `okf:${concept.conceptId}`;

    return {
        namespace,
        key,
        value,
        description: concept.frontmatter.description || concept.frontmatter.title || null,
        fact_type: factType,
        subject: u?.subject ?? null,
        scope: u?.scope ?? null,
        source: sourceName,
        evidence: evidenceFromOkf(concept),
        created_by: options?.createdBy ?? createdByFromVerified(concept.frontmatter.verified),
        confidence: typeof u?.confidence === 'number' ? u.confidence : 0.6,
        relevance_tags: Array.isArray(concept.frontmatter.tags) ? concept.frontmatter.tags.map(String) : [],
        related_facts: Array.isArray(u?.related_facts) ? u.related_facts.map(String) : [],
        actionability: u?.actionability ?? null,
        owner: u?.owner ?? null,
        priority: u?.priority ?? null,
        registry_channel: 'proposed',
        approval_status: 'pending',
        change_reason: `OKF import of ${concept.conceptId}`
    };
}

export function bundleIndexMarkdown(opts: {
    registry: string;
    exportedAt: string;
    conceptCount: number;
    channels: string[];
}): string {
    const fm = {
        type: 'Bundle',
        title: `UniFact export — ${opts.registry}`,
        description: 'Published UniFacts exported as an OKF knowledge bundle. Governed truth remains in UniFact; this bundle is for exchange and agent browsing.',
        tags: ['unifact', 'okf', 'export'],
        unifact: {
            registry: opts.registry,
            export_channels: opts.channels,
            exported_at: opts.exportedAt,
            format: OKF_BUNDLE_FORMAT,
            format_version: OKF_BUNDLE_VERSION
        }
    };
    const yaml = stringifyYaml(fm, { lineWidth: 0 }).trimEnd();
    return `---\n${yaml}\n---\n\n# UniFact → OKF\n\nRegistry: \`${opts.registry}\`  \nConcepts: ${opts.conceptCount}  \nChannels: ${opts.channels.join(', ')}  \nExported: ${opts.exportedAt}\n\n## How to use\n\n- Agents: browse \`unifact/\` concepts; prefer UniFact MCP/\`@Uni\` for live published truth.\n- Import drafts only: \`uni import-okf ./this-bundle\` (proposes; never auto-publishes).\n- Spec: Open Knowledge Format (OKF) — markdown + YAML frontmatter.\n`;
}

export function filterFactsForOkfExport(
    facts: FactResponse[],
    options?: { namespaces?: string[]; channels?: string[] }
): FactResponse[] {
    const channels = new Set(options?.channels?.length ? options.channels : ['published']);
    const namespaces = options?.namespaces?.length ? new Set(options.namespaces) : null;
    return facts.filter((f) => {
        if (!channels.has(f.registry_channel)) return false;
        if (namespaces && !namespaces.has(f.namespace)) return false;
        return true;
    });
}

/**
 * Provenance discipline for propose / publish.
 * Structured evidence is accepted; enforcement is env-driven (usable, not magic chat capture).
 */

export type EvidenceRef = {
    /** Document, ticket, or source URL */
    url?: string;
    /** External ticket id (Jira, Linear, ServiceNow, …) */
    ticket?: string;
    /** Host conversation / thread id when the agent can supply one */
    conversation_id?: string;
    /** Free-form related refs */
    refs?: string[];
    /** Short note */
    note?: string;
};

export type ProvenancePolicy = {
    /** Namespaces that require a non-empty source (empty = none unless requireAll) */
    namespaces: string[];
    /** When true, every namespace requires source */
    requireAll: boolean;
    /** When true (and namespace gated), also require non-empty evidence */
    requireEvidence: boolean;
    /** block = throw; warn = return warning only (CLI may print) */
    mode: 'block' | 'warn';
};

export type ProvenanceCheckInput = {
    namespace: string;
    source?: string | null;
    evidence?: unknown;
    change_reason?: string | null;
    /** publish path (or upsert into published channel) */
    forPublish?: boolean;
};

export type ProvenanceCheckResult = {
    ok: boolean;
    required: boolean;
    errors: string[];
    warnings: string[];
};

function truthyEnv(value: string | undefined): boolean {
    if (!value) return false;
    const v = value.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function parseNamespaceList(raw: string | undefined): string[] {
    if (!raw?.trim()) return [];
    return raw
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/** Match namespace against patterns (`*`, `company.*`, exact). */
export function namespaceMatchesPatterns(namespace: string, patterns: string[]): boolean {
    const normalized = namespace.toLowerCase();
    return patterns.some((pattern) => {
        const p = pattern.toLowerCase();
        if (p === '*') return true;
        if (p.endsWith('.*')) {
            const prefix = p.slice(0, -2);
            return normalized === prefix || normalized.startsWith(`${prefix}.`);
        }
        return normalized === p;
    });
}

/**
 * Policy from env:
 * - UNIFACT_REQUIRE_PROVENANCE=1 → all namespaces
 * - UNIFACT_REQUIRE_PROVENANCE_NAMESPACES=company.constraints,policy → those only (also without global flag)
 * - UNIFACT_REQUIRE_EVIDENCE=1 → evidence required when source is required
 * - UNIFACT_PROVENANCE_MODE=warn|block (default block)
 */
export function getProvenancePolicy(
    env: NodeJS.ProcessEnv = process.env
): ProvenancePolicy {
    const requireAll = truthyEnv(env.UNIFACT_REQUIRE_PROVENANCE);
    const namespaces = parseNamespaceList(env.UNIFACT_REQUIRE_PROVENANCE_NAMESPACES);
    const requireEvidence = truthyEnv(env.UNIFACT_REQUIRE_EVIDENCE);
    const modeRaw = (env.UNIFACT_PROVENANCE_MODE || 'block').trim().toLowerCase();
    const mode: 'block' | 'warn' = modeRaw === 'warn' ? 'warn' : 'block';
    return { namespaces, requireAll, requireEvidence, mode };
}

export function provenanceRequiredForNamespace(
    namespace: string,
    policy: ProvenancePolicy = getProvenancePolicy()
): boolean {
    if (policy.requireAll) return true;
    if (policy.namespaces.length === 0) return false;
    return namespaceMatchesPatterns(namespace, policy.namespaces);
}

/** True when evidence has at least one usable signal. */
export function evidenceIsPresent(evidence: unknown): boolean {
    if (evidence === null || evidence === undefined) return false;
    if (typeof evidence === 'string') return evidence.trim().length > 0;
    if (Array.isArray(evidence)) {
        return evidence.some((item) => evidenceIsPresent(item));
    }
    if (typeof evidence === 'object') {
        const e = evidence as EvidenceRef;
        if (e.url?.trim() || e.ticket?.trim() || e.conversation_id?.trim() || e.note?.trim()) {
            return true;
        }
        if (Array.isArray(e.refs) && e.refs.some((r) => String(r).trim())) return true;
        // Any other non-empty object counts as present (legacy payloads)
        return Object.keys(evidence as object).length > 0;
    }
    return Boolean(evidence);
}

/**
 * Normalize evidence for storage / docs.
 * Accepts string, EvidenceRef, EvidenceRef[], or opaque JSON (passed through).
 */
export function normalizeEvidence(evidence: unknown): unknown {
    if (evidence === null || evidence === undefined) return null;
    if (typeof evidence === 'string') {
        const text = evidence.trim();
        return text || null;
    }
    return evidence;
}

export function checkProvenance(
    input: ProvenanceCheckInput,
    policy: ProvenancePolicy = getProvenancePolicy()
): ProvenanceCheckResult {
    const required = provenanceRequiredForNamespace(input.namespace, policy);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!required) {
        if (!String(input.source || '').trim()) {
            warnings.push('source is empty; set source (and evidence) for challenge-later auditability');
        }
        if (input.forPublish && !String(input.change_reason || '').trim()) {
            warnings.push('change_reason is empty on publish; prefer a short why');
        }
        return { ok: true, required: false, errors, warnings };
    }

    if (!String(input.source || '').trim()) {
        errors.push(
            `source is required for namespace '${input.namespace}' (set UNIFACT_REQUIRE_PROVENANCE / UNIFACT_REQUIRE_PROVENANCE_NAMESPACES)`
        );
    }
    if (policy.requireEvidence && !evidenceIsPresent(input.evidence)) {
        errors.push(
            `evidence is required for namespace '${input.namespace}' (URL, ticket, conversation_id, or note)`
        );
    } else if (!evidenceIsPresent(input.evidence)) {
        warnings.push('evidence is empty; prefer { url, ticket, conversation_id } when available');
    }
    if (input.forPublish && !String(input.change_reason || '').trim()) {
        warnings.push('change_reason is empty on publish; prefer a short why');
    }

    if (errors.length === 0) {
        return { ok: true, required: true, errors, warnings };
    }

    if (policy.mode === 'warn') {
        return { ok: true, required: true, errors: [], warnings: [...warnings, ...errors] };
    }

    return { ok: false, required: true, errors, warnings };
}

/** Throw when policy blocks; otherwise return warnings for callers to surface. */
export function assertProvenance(
    input: ProvenanceCheckInput,
    policy: ProvenancePolicy = getProvenancePolicy()
): string[] {
    const result = checkProvenance(input, policy);
    if (!result.ok) {
        throw new Error(result.errors.join('; '));
    }
    return result.warnings;
}

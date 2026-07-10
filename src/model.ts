export const FACT_REGISTRY_CHANNELS = [
    'working',
    'proposed',
    'review',
    'published',
    'superseded',
    'retracted'
] as const;

export const FACT_VERSION_EVENTS = [
    'create',
    'update',
    'propose',
    'review',
    'publish',
    'supersede',
    'retract',
    'delete'
] as const;
export const FACT_TYPES = [
    'entity_fact',
    'state_fact',
    'insight_fact',
    'decision_fact',
    'constraint_fact',
    'preference_fact',
    'actionable_fact'
] as const;

export const FACT_STATUSES = [
    'active',
    'stale',
    'superseded',
    'retracted',
    'needs_review'
] as const;

export const FACT_DERIVATIONS = [
    'asserted',
    'observed',
    'derived'
] as const;

export const FACT_ACTIONABILITIES = [
    'informational',
    'consider_before_action',
    'requires_action',
    'blocks_action',
    'decision_record',
    'constraint'
] as const;

export const FACT_PRIORITIES = [
    'low',
    'normal',
    'high',
    'critical'
] as const;

export const FACT_APPROVAL_STATUSES = [
    'unreviewed',
    'pending',
    'approved',
    'rejected'
] as const;

export type FactRegistryChannel = typeof FACT_REGISTRY_CHANNELS[number];
export type FactVersionEvent = typeof FACT_VERSION_EVENTS[number];
export type FactType = typeof FACT_TYPES[number];
export type FactStatus = typeof FACT_STATUSES[number];
export type FactDerivation = typeof FACT_DERIVATIONS[number];
export type FactActionability = typeof FACT_ACTIONABILITIES[number];
export type FactPriority = typeof FACT_PRIORITIES[number];
export type FactApprovalStatus = typeof FACT_APPROVAL_STATUSES[number];

export interface FactResponse {
    namespace: string;
    key: string;
    value: string;
    description: string | null;
    fact_type: string;
    subject: string | null;
    scope: string | null;
    status: string;
    derivation: string;
    confidence: number | null;
    source: string | null;
    evidence: unknown;
    valid_from: number | null;
    valid_until: number | null;
    observed_at: number | null;
    time_period: string | null;
    audience: string[];
    relevance_tags: string[];
    actionability: string;
    owner: string | null;
    priority: string;
    related_facts: string[];
    created_by: string | null;
    approved_by: string | null;
    approval_status: string;
    registry_channel: string;
    version: number;
    published_at: number | null;
    published_by: string | null;
    change_reason: string | null;
    supersedes: string | null;
    superseded_by: string | null;
    created_at: number;
    updated_at: number;
}

export interface FactVersionResponse {
    id: number;
    namespace: string;
    key: string;
    version: number;
    event: string;
    registry_channel: string;
    snapshot: unknown;
    author: string | null;
    change_reason: string | null;
    created_at: number;
}

export interface AgentProfileResponse {
    id: string;
    name: string;
    description: string | null;
    role: string;
    allowed_fact_types: string[];
    writable_fact_types: string[];
    relevant_scopes: string[];
    relevant_subjects: string[];
    intents: string[];
    audience_tags: string[];
    can_propose_facts: boolean;
    can_approve_facts: boolean;
    allowed_actions: string[];
    requires_human_approval_for: string[];
    created_at: number;
    updated_at: number;
}

export function normalizeEnumValue<T extends string>(
    value: unknown,
    allowed: readonly T[],
    field: string
): T {
    const text = String(value);
    if (!allowed.includes(text as T)) {
        throw new Error(`${field} must be one of: ${allowed.join(', ')}`);
    }
    return text as T;
}

export function normalizeNullableString(value: unknown, field: string): string | null {
    if (value === null || value === undefined) {
        return null;
    }

    const text = String(value).trim();
    if (!text) {
        return null;
    }

    return text;
}

export function normalizeRequiredString(value: unknown, field: string): string {
    const text = normalizeNullableString(value, field);
    if (!text) {
        throw new Error(`${field} is required`);
    }
    return text;
}

export function serializeValue(value: unknown): string {
    if (value === undefined) {
        throw new Error('value is required');
    }

    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (serialized === undefined) {
        throw new Error('value must be JSON-serializable');
    }

    return serialized;
}

export function serializeStringList(value: unknown, field: string): string | null {
    if (value === null || value === undefined) {
        return null;
    }

    const items = Array.isArray(value) ? value : [value];
    const strings = items
        .map(item => String(item).trim())
        .filter(Boolean);

    if (strings.length === 0) {
        return JSON.stringify([]);
    }

    return JSON.stringify([...new Set(strings)]);
}

export function serializeStringListOrEmpty(value: unknown, field: string): string {
    return serializeStringList(value, field) ?? '[]';
}

export function parseStringList(value: string | null): string[] {
    if (!value) {
        return [];
    }

    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) {
            return [String(parsed)];
        }

        return parsed
            .map(item => String(item).trim())
            .filter(Boolean);
    } catch (_err) {
        return [value];
    }
}

export function serializeJsonPayload(value: unknown, field: string): string | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value === 'string') {
        return value;
    }

    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        throw new Error(`${field} must be JSON-serializable`);
    }

    return serialized;
}

export function parseJsonPayload(value: string | null): unknown {
    if (value === null) {
        return null;
    }

    try {
        return JSON.parse(value) as unknown;
    } catch (_err) {
        return value;
    }
}

export function normalizeConfidence(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const confidence = Number(value);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
        throw new Error('confidence must be a number between 0 and 1');
    }

    return confidence;
}

export function normalizeTimestamp(value: unknown, field: string): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new Error(`${field} must be a valid timestamp`);
        }
        return Math.trunc(value);
    }

    const text = String(value).trim();
    const numeric = Number(text);
    if (Number.isFinite(numeric)) {
        return Math.trunc(numeric);
    }

    const parsed = Date.parse(text);
    if (Number.isNaN(parsed)) {
        throw new Error(`${field} must be a millisecond timestamp or parseable date string`);
    }

    return parsed;
}

export function normalizeBoolean(value: unknown, field: string): boolean {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value !== 0;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes'].includes(normalized)) {
            return true;
        }
        if (['false', '0', 'no'].includes(normalized)) {
            return false;
        }
    }

    throw new Error(`${field} must be a boolean`);
}

export function hasOwn(input: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(input, key);
}
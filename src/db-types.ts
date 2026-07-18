export type DbBackendKind = 'sqlite' | 'postgres';

export interface RunResult {
    changes: number;
    lastInsertRowid?: number | bigint;
}

export interface DbClient {
    readonly backend: DbBackendKind;
    /** SQLite file path, or `"postgres"` when using DATABASE_URL. */
    readonly name: string;
    get<T = unknown>(sql: string, params?: unknown[]): Promise<T | undefined>;
    all<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
    run(sql: string, params?: unknown[]): Promise<RunResult>;
    exec(sql: string): Promise<void>;
    transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>;
    /** SQL predicate (with one `?` placeholder) that filters facts by full-text query. */
    factSearchClause(): string;
}

export interface FactRow {
    rowid: number;
    registry_name: string;
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
    evidence: string | null;
    valid_from: number | null;
    valid_until: number | null;
    observed_at: number | null;
    time_period: string | null;
    audience: string | null;
    relevance_tags: string | null;
    actionability: string;
    owner: string | null;
    priority: string;
    related_facts: string | null;
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

export interface AuditLogRow {
    id: number;
    action: string;
    registry_name?: string;
    namespace: string;
    key: string;
    old_value: string | null;
    new_value: string | null;
    old_snapshot: string | null;
    new_snapshot: string | null;
    timestamp: number;
}

export interface AgentProfileRow {
    id: string;
    name: string;
    description: string | null;
    role: string;
    allowed_fact_types: string;
    writable_fact_types: string;
    relevant_scopes: string;
    relevant_subjects: string;
    intents: string;
    audience_tags: string;
    can_propose_facts: number;
    can_approve_facts: number;
    allowed_actions: string;
    requires_human_approval_for: string;
    created_at: number;
    updated_at: number;
}

export interface FactVersionRow {
    id: number;
    registry_name: string;
    namespace: string;
    key: string;
    version: number;
    event: string;
    registry_channel: string;
    snapshot: string;
    author: string | null;
    change_reason: string | null;
    created_at: number;
}

/** One API key per person; toggle with enabled (1=on, 0=off). */
export interface ApiKeyRow {
    id: string;
    person: string;
    api_key: string;
    enabled: number;
    namespaces: string;
    scopes: string;
    registry_name: string | null;
    created_at: number;
    updated_at: number;
}

export interface RegistryRow {
    id: string;
    name: string;
    owner_person: string;
    description: string | null;
    git_url: string | null;
    /** Parent registry for namespace lookup (read-only for child members). */
    parent_registry: string | null;
    /**
     * org = discoverable + published facts lookable by any registry on this host.
     * private = only members may look up / discover.
     */
    lookup_visibility: 'private' | 'org';
    created_at: number;
    updated_at: number;
}

export interface JoinRequestRow {
    id: string;
    registry_name: string;
    person: string;
    status: string;
    message: string | null;
    created_at: number;
    updated_at: number;
}

/** Org-scoped ops counters (errors/calls) — not facts. */
export interface OpsEventRow {
    id: number;
    registry_name: string;
    kind: string;
    event_code: string;
    event_count: number | string;
    first_seen: number | string;
    last_seen: number | string;
    label: string;
    extra_context: string | null;
    env: string | null;
    source: string | null;
}

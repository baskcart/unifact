import { db, AgentProfileRow, AuditLogRow, FactRow, FactVersionRow } from './db.js';
import {
    AgentProfileResponse,
    FACT_ACTIONABILITIES,
    FACT_APPROVAL_STATUSES,
    FACT_DERIVATIONS,
    FACT_PRIORITIES,
    FACT_REGISTRY_CHANNELS,
    FACT_VERSION_EVENTS,
    FACT_STATUSES,
    FACT_TYPES,
    LOCAL_AGENT_CHANNELS,
    FactResponse,
    FactVersionResponse,
    hasOwn,
    normalizeBoolean,
    normalizeConfidence,
    normalizeEnumValue,
    normalizeNullableString,
    normalizeRequiredString,
    normalizeTimestamp,
    parseJsonPayload,
    parseStringList,
    serializeJsonPayload,
    serializeStringList,
    serializeStringListOrEmpty,
    serializeValue
} from './model.js';
import { getSyncConfig, getRemoteBranchUrl } from './sync.js';
import { apiKeyAllowsNamespace, findApiKeyBySecret, listApiKeys } from './keys.js';
import { assertCanWriteRegistry } from './registry.js';
import { namespaceChain } from './namespaces.js';
import { assertNamespaceNameAvailable } from './naming.js';

export const FACT_SELECT_COLUMNS = `
  rowid, registry_name, namespace, key, value, description, fact_type, subject, scope, status,
  derivation, confidence, source, evidence, valid_from, valid_until,
  observed_at, time_period, audience, relevance_tags, actionability, owner,
  priority, related_facts, created_by, approved_by, approval_status,
  registry_channel, version, published_at, published_by, change_reason,
  supersedes, superseded_by, created_at, updated_at
`;

const AGENT_PROFILE_SELECT_COLUMNS = `
  id, name, description, role, allowed_fact_types, writable_fact_types,
  relevant_scopes, relevant_subjects, intents, audience_tags,
  can_propose_facts, can_approve_facts, allowed_actions,
  requires_human_approval_for, created_at, updated_at
`;

type InputRecord = Record<string, unknown>;

type FactColumns = {
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
    published_at: number | null;
    published_by: string | null;
    change_reason: string | null;
    supersedes: string | null;
    superseded_by: string | null;
};

type AgentProfileColumns = {
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
};

export interface UpsertFactResult {
    success: true;
    action: 'CREATE' | 'UPDATE';
    fact: FactResponse;
}

export interface UpsertAgentProfileResult {
    success: true;
    action: 'CREATE' | 'UPDATE';
    profile: AgentProfileResponse;
}

export interface RelevantFactQuery {
    registry_name: string;
    profile_id?: string;
    namespace?: string;
    subject?: string;
    scope?: string;
    intent?: string;
    actionability?: string;
    fact_type?: string;
    status?: string;
    include_inactive?: boolean;
    include_review?: boolean;
    limit?: number;
    query?: string;
    registry_channel?: string;
    published_only?: boolean;
    /** When true, include proposed/review/feedback/published (local/dev agents). */
    local_agent?: boolean;
    /** Walk parent registry lookup path (default true). Parents are published-only. */
    lookup?: boolean;
}

export interface RelevantFactResult {
    fact: FactResponse;
    relevance: {
        score: number;
        reasons: string[];
        should_act: boolean;
        owner_matched: boolean;
        action_allowed: boolean;
        requires_human_approval: boolean;
    };
}

function listFromExisting(value: string | null | undefined): string {
    return value ?? '[]';
}

function maybeString(input: InputRecord, field: string, existing: string | null | undefined): string | null {
    return hasOwn(input, field) ? normalizeNullableString(input[field], field) : existing ?? null;
}

function maybeList(input: InputRecord, field: string, existing: string | null | undefined): string | null {
    return hasOwn(input, field) ? serializeStringList(input[field], field) : existing ?? null;
}

function maybeListOrEmpty(input: InputRecord, field: string, existing: string | undefined): string {
    return hasOwn(input, field) ? serializeStringListOrEmpty(input[field], field) : existing ?? '[]';
}

function maybeTimestamp(input: InputRecord, field: string, existing: number | null | undefined): number | null {
    return hasOwn(input, field) ? normalizeTimestamp(input[field], field) : existing ?? null;
}

function boolToInt(value: boolean): number {
    return value ? 1 : 0;
}

function buildFactColumns(input: InputRecord, existing?: FactRow): FactColumns {
    return {
        description: maybeString(input, 'description', existing?.description),
        fact_type: hasOwn(input, 'fact_type')
            ? normalizeEnumValue(input.fact_type, FACT_TYPES, 'fact_type')
            : existing?.fact_type ?? 'entity_fact',
        subject: maybeString(input, 'subject', existing?.subject),
        scope: maybeString(input, 'scope', existing?.scope),
        status: hasOwn(input, 'status')
            ? normalizeEnumValue(input.status, FACT_STATUSES, 'status')
            : existing?.status ?? 'active',
        derivation: hasOwn(input, 'derivation')
            ? normalizeEnumValue(input.derivation, FACT_DERIVATIONS, 'derivation')
            : existing?.derivation ?? 'asserted',
        confidence: hasOwn(input, 'confidence') ? normalizeConfidence(input.confidence) : existing?.confidence ?? null,
        source: maybeString(input, 'source', existing?.source),
        evidence: hasOwn(input, 'evidence') ? serializeJsonPayload(input.evidence, 'evidence') : existing?.evidence ?? null,
        valid_from: maybeTimestamp(input, 'valid_from', existing?.valid_from),
        valid_until: maybeTimestamp(input, 'valid_until', existing?.valid_until),
        observed_at: maybeTimestamp(input, 'observed_at', existing?.observed_at),
        time_period: maybeString(input, 'time_period', existing?.time_period),
        audience: maybeList(input, 'audience', existing?.audience),
        relevance_tags: maybeList(input, 'relevance_tags', existing?.relevance_tags),
        actionability: hasOwn(input, 'actionability')
            ? normalizeEnumValue(input.actionability, FACT_ACTIONABILITIES, 'actionability')
            : existing?.actionability ?? 'informational',
        owner: maybeString(input, 'owner', existing?.owner),
        priority: hasOwn(input, 'priority')
            ? normalizeEnumValue(input.priority, FACT_PRIORITIES, 'priority')
            : existing?.priority ?? 'normal',
        related_facts: maybeList(input, 'related_facts', existing?.related_facts),
        created_by: maybeString(input, 'created_by', existing?.created_by),
        approved_by: maybeString(input, 'approved_by', existing?.approved_by),
        approval_status: hasOwn(input, 'approval_status')
            ? normalizeEnumValue(input.approval_status, FACT_APPROVAL_STATUSES, 'approval_status')
            : existing?.approval_status ?? 'unreviewed',
        registry_channel: hasOwn(input, 'registry_channel')
            ? normalizeEnumValue(input.registry_channel, FACT_REGISTRY_CHANNELS, 'registry_channel')
            : existing?.registry_channel ?? (input.approval_status === 'approved' ? 'published' : 'proposed'),
        published_at: maybeTimestamp(input, 'published_at', existing?.published_at),
        published_by: maybeString(input, 'published_by', existing?.published_by),
        change_reason: maybeString(input, 'change_reason', existing?.change_reason),
        supersedes: maybeString(input, 'supersedes', existing?.supersedes),
        superseded_by: maybeString(input, 'superseded_by', existing?.superseded_by)
    };
}

function buildAgentProfileColumns(id: string, input: InputRecord, existing?: AgentProfileRow): AgentProfileColumns {
    return {
        name: hasOwn(input, 'name') ? normalizeRequiredString(input.name, 'name') : existing?.name ?? id,
        description: maybeString(input, 'description', existing?.description),
        role: hasOwn(input, 'role') ? normalizeRequiredString(input.role, 'role') : existing?.role ?? id,
        allowed_fact_types: maybeListOrEmpty(input, 'allowed_fact_types', existing?.allowed_fact_types),
        writable_fact_types: maybeListOrEmpty(input, 'writable_fact_types', existing?.writable_fact_types),
        relevant_scopes: maybeListOrEmpty(input, 'relevant_scopes', existing?.relevant_scopes),
        relevant_subjects: maybeListOrEmpty(input, 'relevant_subjects', existing?.relevant_subjects),
        intents: maybeListOrEmpty(input, 'intents', existing?.intents),
        audience_tags: maybeListOrEmpty(input, 'audience_tags', existing?.audience_tags),
        can_propose_facts: hasOwn(input, 'can_propose_facts')
            ? boolToInt(normalizeBoolean(input.can_propose_facts, 'can_propose_facts'))
            : existing?.can_propose_facts ?? 1,
        can_approve_facts: hasOwn(input, 'can_approve_facts')
            ? boolToInt(normalizeBoolean(input.can_approve_facts, 'can_approve_facts'))
            : existing?.can_approve_facts ?? 0,
        allowed_actions: maybeListOrEmpty(input, 'allowed_actions', existing?.allowed_actions),
        requires_human_approval_for: maybeListOrEmpty(
            input,
            'requires_human_approval_for',
            existing?.requires_human_approval_for
        )
    };
}

export function factFromRow(row: FactRow): FactResponse {
    return {
        registry_name: row.registry_name,
        namespace: row.namespace,
        key: row.key,
        value: row.value,
        description: row.description,
        fact_type: row.fact_type,
        subject: row.subject,
        scope: row.scope,
        status: row.status,
        derivation: row.derivation,
        confidence: row.confidence,
        source: row.source,
        evidence: parseJsonPayload(row.evidence),
        valid_from: row.valid_from,
        valid_until: row.valid_until,
        observed_at: row.observed_at,
        time_period: row.time_period,
        audience: parseStringList(row.audience),
        relevance_tags: parseStringList(row.relevance_tags),
        actionability: row.actionability,
        owner: row.owner,
        priority: row.priority,
        related_facts: parseStringList(row.related_facts),
        created_by: row.created_by,
        approved_by: row.approved_by,
        approval_status: row.approval_status,
        registry_channel: row.registry_channel,
        version: row.version,
        published_at: row.published_at,
        published_by: row.published_by,
        change_reason: row.change_reason,
        supersedes: row.supersedes,
        superseded_by: row.superseded_by,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

export function agentProfileFromRow(row: AgentProfileRow): AgentProfileResponse {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        role: row.role,
        allowed_fact_types: parseStringList(listFromExisting(row.allowed_fact_types)),
        writable_fact_types: parseStringList(listFromExisting(row.writable_fact_types)),
        relevant_scopes: parseStringList(listFromExisting(row.relevant_scopes)),
        relevant_subjects: parseStringList(listFromExisting(row.relevant_subjects)),
        intents: parseStringList(listFromExisting(row.intents)),
        audience_tags: parseStringList(listFromExisting(row.audience_tags)),
        can_propose_facts: row.can_propose_facts === 1,
        can_approve_facts: row.can_approve_facts === 1,
        allowed_actions: parseStringList(listFromExisting(row.allowed_actions)),
        requires_human_approval_for: parseStringList(listFromExisting(row.requires_human_approval_for)),
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

export async function getFactRow(registryName: string, namespace: string, key: string): Promise<FactRow | undefined> {
    return db.get<FactRow>(`
      SELECT ${FACT_SELECT_COLUMNS}
      FROM facts
      WHERE registry_name = ? AND namespace = ? AND key = ?
    `, [registryName, namespace, key]);
}

export async function listFacts(registryName: string, namespace: string): Promise<FactRow[]> {
    return db.all<FactRow>(`
      SELECT ${FACT_SELECT_COLUMNS}
      FROM facts
      WHERE registry_name = ? AND namespace = ?
      ORDER BY key
    `, [registryName, namespace]);
}

export async function listFactNamespaces(registryName: string): Promise<string[]> {
    const rows = await db.all<{ namespace: string }>(`
      SELECT DISTINCT namespace
      FROM facts
      WHERE registry_name = ?
      ORDER BY namespace
    `, [registryName]);
    return rows.map((row) => row.namespace);
}

export async function listFactsByChannels(registryName: string, channels: string[]): Promise<FactResponse[]> {
    if (channels.length === 0) return [];
    const placeholders = channels.map(() => '?').join(', ');
    const rows = await db.all<FactRow>(`
      SELECT ${FACT_SELECT_COLUMNS}
      FROM facts
      WHERE registry_name = ? AND registry_channel IN (${placeholders})
      ORDER BY namespace, key
    `, [registryName, ...channels]);
    return rows.map(factFromRow);
}

export async function searchFacts(registryName: string, query: string): Promise<FactRow[]> {
    return db.all<FactRow>(`
      SELECT ${FACT_SELECT_COLUMNS}
      FROM facts
      WHERE registry_name = ? AND ${db.factSearchClause()}
      ORDER BY namespace, key
    `, [registryName, query]);
}

export function factVersionFromRow(row: FactVersionRow): FactVersionResponse {
    return {
        id: row.id,
        registry_name: row.registry_name,
        namespace: row.namespace,
        key: row.key,
        version: row.version,
        event: row.event,
        registry_channel: row.registry_channel,
        snapshot: parseJsonPayload(row.snapshot),
        author: row.author,
        change_reason: row.change_reason,
        created_at: row.created_at
    };
}

async function recordFactVersion(row: FactRow, event: string, author: string | null, changeReason: string | null, now: number) {
    await db.run(`
      INSERT INTO fact_versions (
        registry_name, namespace, key, version, event, registry_channel, snapshot,
        author, change_reason, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        row.registry_name,
        row.namespace,
        row.key,
        row.version,
        event,
        row.registry_channel,
        JSON.stringify(factFromRow(row)),
        author,
        changeReason,
        now
    ]);
}

function requestedVersionEvent(input: InputRecord, action: 'CREATE' | 'UPDATE'): string {
    if (hasOwn(input, '_event')) {
        return normalizeEnumValue(input._event, FACT_VERSION_EVENTS, '_event');
    }
    return action === 'CREATE' ? 'create' : 'update';
}

function versionAuthor(columns: FactColumns): string | null {
    return columns.published_by ?? columns.approved_by ?? columns.created_by;
}

export async function listFactVersions(registryName: string, namespace: string, key: string): Promise<FactVersionResponse[]> {
    const rows = await db.all<FactVersionRow>(`
      SELECT id, registry_name, namespace, key, version, event, registry_channel,
             snapshot, author, change_reason, created_at
      FROM fact_versions
      WHERE registry_name = ? AND namespace = ? AND key = ?
      ORDER BY id DESC
    `, [registryName, namespace, key]);

    return rows.map(factVersionFromRow);
}

export async function upsertFact(registryName: string, namespace: string, key: string, input: InputRecord): Promise<UpsertFactResult> {
    const storedValue = serializeValue(input.value);
    const now = Date.now();
    const existing = await getFactRow(registryName, namespace, key);

    // New namespace in this registry must not collide with a registry name.
    if (!existing) {
        const nsInUse = await db.get<{ n: number }>(
            `
          SELECT COUNT(*) AS n FROM facts
          WHERE registry_name = ? AND lower(namespace) = lower(?)
        `,
            [registryName, namespace]
        );
        if ((nsInUse?.n ?? 0) === 0) {
            await assertNamespaceNameAvailable(namespace);
        }
    }

    const columns = buildFactColumns(input, existing);
    const action: 'CREATE' | 'UPDATE' = existing ? 'UPDATE' : 'CREATE';
    const event = requestedVersionEvent(input, action);
    const nextVersion = existing ? existing.version + 1 : 1;
    const oldSnapshot = existing ? JSON.stringify(factFromRow(existing)) : null;

    const saved = await db.transaction(async () => {
        if (existing) {
            await db.run(`
              UPDATE facts
              SET value = ?, description = ?, fact_type = ?, subject = ?, scope = ?,
                  status = ?, derivation = ?, confidence = ?, source = ?, evidence = ?,
                  valid_from = ?, valid_until = ?, observed_at = ?, time_period = ?,
                  audience = ?, relevance_tags = ?, actionability = ?, owner = ?,
                  priority = ?, related_facts = ?, created_by = ?, approved_by = ?,
                  approval_status = ?, registry_channel = ?, version = ?, published_at = ?,
                  published_by = ?, change_reason = ?, supersedes = ?, superseded_by = ?,
                  updated_at = ?
              WHERE registry_name = ? AND namespace = ? AND key = ?
            `, [
                storedValue,
                columns.description,
                columns.fact_type,
                columns.subject,
                columns.scope,
                columns.status,
                columns.derivation,
                columns.confidence,
                columns.source,
                columns.evidence,
                columns.valid_from,
                columns.valid_until,
                columns.observed_at,
                columns.time_period,
                columns.audience,
                columns.relevance_tags,
                columns.actionability,
                columns.owner,
                columns.priority,
                columns.related_facts,
                columns.created_by,
                columns.approved_by,
                columns.approval_status,
                columns.registry_channel,
                nextVersion,
                columns.published_at,
                columns.published_by,
                columns.change_reason,
                columns.supersedes,
                columns.superseded_by,
                now,
                registryName,
                namespace,
                key
            ]);
        } else {
            await db.run(`
              INSERT INTO facts (
                registry_name, namespace, key, value, description, fact_type, subject, scope,
                status, derivation, confidence, source, evidence, valid_from,
                valid_until, observed_at, time_period, audience, relevance_tags,
                actionability, owner, priority, related_facts, created_by,
                approved_by, approval_status, registry_channel, version,
                published_at, published_by, change_reason, supersedes,
                superseded_by, created_at, updated_at
              )
              VALUES (${Array(35).fill('?').join(', ')})
            `, [
                registryName,
                namespace,
                key,
                storedValue,
                columns.description,
                columns.fact_type,
                columns.subject,
                columns.scope,
                columns.status,
                columns.derivation,
                columns.confidence,
                columns.source,
                columns.evidence,
                columns.valid_from,
                columns.valid_until,
                columns.observed_at,
                columns.time_period,
                columns.audience,
                columns.relevance_tags,
                columns.actionability,
                columns.owner,
                columns.priority,
                columns.related_facts,
                columns.created_by,
                columns.approved_by,
                columns.approval_status,
                columns.registry_channel,
                nextVersion,
                columns.published_at,
                columns.published_by,
                columns.change_reason,
                columns.supersedes,
                columns.superseded_by,
                now,
                now
            ]);
        }

        const savedRow = await getFactRow(registryName, namespace, key);
        if (!savedRow) {
            throw new Error(`Failed to load saved fact '${namespace}/${key}'`);
        }

        await db.run(`
          INSERT INTO audit_log (
            action, registry_name, namespace, key, old_value, new_value, old_snapshot,
            new_snapshot, timestamp
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            action,
            registryName,
            namespace,
            key,
            existing?.value ?? null,
            storedValue,
            oldSnapshot,
            JSON.stringify(factFromRow(savedRow)),
            now
        ]);

        await recordFactVersion(savedRow, event, versionAuthor(columns), columns.change_reason, now);
        return savedRow;
    });

    return {
        success: true,
        action,
        fact: factFromRow(saved)
    };
}

export async function deleteFact(registryName: string, namespace: string, key: string): Promise<boolean> {
    const existing = await getFactRow(registryName, namespace, key);
    if (!existing) {
        return false;
    }

    const now = Date.now();
    await db.transaction(async () => {
        await recordFactVersion(existing, 'delete', existing.created_by, existing.change_reason, now);
        await db.run('DELETE FROM facts WHERE registry_name = ? AND namespace = ? AND key = ?', [registryName, namespace, key]);
        await db.run(`
          INSERT INTO audit_log (
            action, registry_name, namespace, key, old_value, new_value, old_snapshot,
            new_snapshot, timestamp
          )
          VALUES ('DELETE', ?, ?, ?, ?, NULL, ?, NULL, ?)
        `, [registryName, namespace, key, existing.value, JSON.stringify(factFromRow(existing)), now]);
    });

    return true;
}

export async function getAgentProfileRow(id: string): Promise<AgentProfileRow | undefined> {
    return db.get<AgentProfileRow>(`
      SELECT ${AGENT_PROFILE_SELECT_COLUMNS}
      FROM agent_profiles
      WHERE id = ?
    `, [id]);
}

export async function listAgentProfiles(): Promise<AgentProfileResponse[]> {
    const rows = await db.all<AgentProfileRow>(`
      SELECT ${AGENT_PROFILE_SELECT_COLUMNS}
      FROM agent_profiles
      ORDER BY name
    `);

    return rows.map(agentProfileFromRow);
}

export async function upsertAgentProfile(id: string, input: InputRecord): Promise<UpsertAgentProfileResult> {
    const now = Date.now();
    const existing = await getAgentProfileRow(id);
    const columns = buildAgentProfileColumns(id, input, existing);
    const action: 'CREATE' | 'UPDATE' = existing ? 'UPDATE' : 'CREATE';

    const saved = await db.transaction(async () => {
        if (existing) {
            await db.run(`
              UPDATE agent_profiles
              SET name = ?, description = ?, role = ?, allowed_fact_types = ?,
                  writable_fact_types = ?, relevant_scopes = ?, relevant_subjects = ?,
                  intents = ?, audience_tags = ?, can_propose_facts = ?,
                  can_approve_facts = ?, allowed_actions = ?,
                  requires_human_approval_for = ?, updated_at = ?
              WHERE id = ?
            `, [
                columns.name,
                columns.description,
                columns.role,
                columns.allowed_fact_types,
                columns.writable_fact_types,
                columns.relevant_scopes,
                columns.relevant_subjects,
                columns.intents,
                columns.audience_tags,
                columns.can_propose_facts,
                columns.can_approve_facts,
                columns.allowed_actions,
                columns.requires_human_approval_for,
                now,
                id
            ]);
        } else {
            await db.run(`
              INSERT INTO agent_profiles (
                id, name, description, role, allowed_fact_types,
                writable_fact_types, relevant_scopes, relevant_subjects, intents,
                audience_tags, can_propose_facts, can_approve_facts,
                allowed_actions, requires_human_approval_for, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                id,
                columns.name,
                columns.description,
                columns.role,
                columns.allowed_fact_types,
                columns.writable_fact_types,
                columns.relevant_scopes,
                columns.relevant_subjects,
                columns.intents,
                columns.audience_tags,
                columns.can_propose_facts,
                columns.can_approve_facts,
                columns.allowed_actions,
                columns.requires_human_approval_for,
                now,
                now
            ]);
        }

        const savedRow = await getAgentProfileRow(id);
        if (!savedRow) {
            throw new Error(`Failed to load saved agent profile '${id}'`);
        }
        return savedRow;
    });

    return {
        success: true,
        action,
        profile: agentProfileFromRow(saved)
    };
}

export async function deleteAgentProfile(id: string): Promise<boolean> {
    const existing = await getAgentProfileRow(id);
    if (!existing) {
        return false;
    }

    await db.run('DELETE FROM agent_profiles WHERE id = ?', [id]);
    return true;
}

function lowerList(values: string[]): string[] {
    return values.map(value => value.toLowerCase());
}

function matchesPattern(value: string | null, patterns: string[]): boolean {
    if (!value) {
        return false;
    }

    const normalized = value.toLowerCase();
    return lowerList(patterns).some(pattern => {
        if (pattern === '*') {
            return true;
        }
        if (pattern.endsWith('.*')) {
            const prefix = pattern.slice(0, -2);
            return normalized === prefix || normalized.startsWith(`${prefix}.`);
        }
        return normalized === pattern;
    });
}

function overlaps(values: string[], patterns: string[]): boolean {
    return values.some(value => matchesPattern(value, patterns));
}

function clampLimit(limit: number | undefined): number {
    if (!limit || !Number.isFinite(limit)) {
        return 50;
    }

    return Math.max(1, Math.min(500, Math.trunc(limit)));
}

function profileTargets(profile: AgentProfileResponse): string[] {
    return [profile.id, profile.role, ...profile.audience_tags];
}

function rankFact(row: FactRow, profile: AgentProfileResponse | null, query: RelevantFactQuery): RelevantFactResult | null {
    const fact = factFromRow(row);
    const reasons: string[] = [];
    let score = 1;
    let ownerMatched = false;
    let requiresHumanApproval = false;

    if (profile) {
        const targets = profileTargets(profile);

        if (profile.allowed_fact_types.length > 0 && !matchesPattern(row.fact_type, profile.allowed_fact_types)) {
            return null;
        }
        if (profile.relevant_scopes.length > 0 && row.scope && !matchesPattern(row.scope, profile.relevant_scopes)) {
            return null;
        }
        if (profile.relevant_subjects.length > 0 && row.subject && !matchesPattern(row.subject, profile.relevant_subjects)) {
            return null;
        }

        if (matchesPattern(row.fact_type, profile.allowed_fact_types)) {
            score += 4;
            reasons.push('fact type is allowed for this profile');
        }
        if (!row.scope) {
            score += 1;
            reasons.push('fact has global scope');
        } else if (matchesPattern(row.scope, profile.relevant_scopes)) {
            score += 3;
            reasons.push('scope matches profile');
        }
        if (!row.subject) {
            score += 1;
        } else if (matchesPattern(row.subject, profile.relevant_subjects)) {
            score += 3;
            reasons.push('subject matches profile');
        }
        if (fact.audience.length === 0) {
            score += 1;
        } else if (overlaps(fact.audience, targets)) {
            score += 4;
            reasons.push('audience matches profile');
        } else {
            score -= 2;
        }
        if (query.intent && fact.relevance_tags.some(tag => matchesPattern(tag, [query.intent as string]))) {
            score += 4;
            reasons.push('intent matches fact relevance tags');
        }
        if (row.owner && matchesPattern(row.owner, targets)) {
            score += 3;
            ownerMatched = true;
            reasons.push('owner matches profile');
        }
        requiresHumanApproval = matchesPattern(row.actionability, profile.requires_human_approval_for);
    }

    if (row.status === 'active') {
        score += 2;
    } else if (row.status === 'needs_review') {
        score += profile?.can_approve_facts ? 1 : -2;
        reasons.push('fact is waiting for review');
    }

    if (row.actionability === 'requires_action' || row.actionability === 'blocks_action') {
        score += 3;
        reasons.push('fact is actionable');
    } else if (row.actionability === 'consider_before_action') {
        score += 2;
        reasons.push('fact should be considered before acting');
    } else if (row.actionability === 'constraint') {
        score += 2;
        reasons.push('fact is a constraint');
    }

    if (row.priority === 'critical') {
        score += 4;
        reasons.push('critical priority');
    } else if (row.priority === 'high') {
        score += 2;
        reasons.push('high priority');
    }

    if (typeof row.confidence === 'number') {
        score += Math.round(row.confidence * 2);
    }

    const shouldAct = row.actionability === 'requires_action' || row.actionability === 'blocks_action';
    const actionAllowed = Boolean(
        shouldAct &&
        profile &&
        profile.allowed_actions.length > 0 &&
        !requiresHumanApproval &&
        (!row.owner || ownerMatched || matchesPattern(row.owner, profileTargets(profile)))
    );

    return {
        fact,
        relevance: {
            score,
            reasons,
            should_act: shouldAct,
            owner_matched: ownerMatched,
            action_allowed: actionAllowed,
            requires_human_approval: shouldAct && requiresHumanApproval
        }
    };
}

export async function findRelevantFacts(query: RelevantFactQuery): Promise<{ profile: AgentProfileResponse | null; results: RelevantFactResult[]; count: number }> {
    const profileRow = query.profile_id ? await getAgentProfileRow(query.profile_id) : undefined;
    if (query.profile_id && !profileRow) {
        throw new Error(`Agent profile '${query.profile_id}' not found`);
    }

    const profile = profileRow ? agentProfileFromRow(profileRow) : null;
    const homeRegistry = query.registry_name;
    const useLookup = query.lookup !== false;

    type Scope = { registry: string; namespaces: string[] | null; publishedOnly: boolean; source: 'local' | 'parent' | 'lookup' };
    const scopes: Scope[] = [];

    if (query.namespace && useLookup) {
        const chain = namespaceChain(query.namespace);
        scopes.push({
            registry: homeRegistry,
            namespaces: [chain[0]],
            publishedOnly: false,
            source: 'local'
        });
        if (chain.length > 1) {
            scopes.push({
                registry: homeRegistry,
                namespaces: chain.slice(1),
                publishedOnly: true,
                source: 'parent'
            });
        }
        // Explicit lookups for this namespace chain
        await db.run(`
          CREATE TABLE IF NOT EXISTS namespace_lookups (
            id TEXT PRIMARY KEY,
            registry_name TEXT NOT NULL,
            from_namespace TEXT NOT NULL,
            target_registry TEXT NOT NULL,
            target_namespace TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(registry_name, from_namespace, target_registry, target_namespace)
          )
        `).catch(() => undefined);
        const placeholders = chain.map(() => '?').join(', ');
        const lookupRows = await db.all<{
            target_registry: string;
            target_namespace: string;
        }>(
            `
          SELECT DISTINCT target_registry, target_namespace
          FROM namespace_lookups
          WHERE lower(registry_name) = lower(?)
            AND from_namespace IN (${placeholders})
        `,
            [homeRegistry, ...chain]
        );
        for (const row of lookupRows) {
            scopes.push({
                registry: row.target_registry,
                namespaces: [row.target_namespace],
                publishedOnly: true,
                source: 'lookup'
            });
        }
    } else {
        scopes.push({
            registry: homeRegistry,
            namespaces: query.namespace ? [query.namespace] : null,
            publishedOnly: false,
            source: 'local'
        });
        if (useLookup && !query.namespace) {
            await db.run(`
              CREATE TABLE IF NOT EXISTS namespace_lookups (
                id TEXT PRIMARY KEY,
                registry_name TEXT NOT NULL,
                from_namespace TEXT NOT NULL,
                target_registry TEXT NOT NULL,
                target_namespace TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(registry_name, from_namespace, target_registry, target_namespace)
              )
            `).catch(() => undefined);
            const lookupRows = await db.all<{
                target_registry: string;
                target_namespace: string;
            }>(
                `
              SELECT DISTINCT target_registry, target_namespace
              FROM namespace_lookups
              WHERE lower(registry_name) = lower(?)
            `,
                [homeRegistry]
            );
            for (const row of lookupRows) {
                scopes.push({
                    registry: row.target_registry,
                    namespaces: [row.target_namespace],
                    publishedOnly: true,
                    source: 'lookup'
                });
            }
        }
    }

    const allRows: Array<{ row: FactRow; source: 'local' | 'parent' | 'lookup' }> = [];
    const seen = new Set<string>();

    for (const scope of scopes) {
        const clauses: string[] = ['registry_name = ?'];
        const params: unknown[] = [scope.registry];

        if (query.query) {
            clauses.push(db.factSearchClause());
            params.push(query.query);
        }
        if (scope.namespaces && scope.namespaces.length === 1) {
            clauses.push('namespace = ?');
            params.push(scope.namespaces[0]);
        } else if (scope.namespaces && scope.namespaces.length > 1) {
            clauses.push(`namespace IN (${scope.namespaces.map(() => '?').join(', ')})`);
            params.push(...scope.namespaces);
        }
        if (query.subject) {
            clauses.push('subject = ?');
            params.push(query.subject);
        }
        if (query.scope) {
            clauses.push('scope = ?');
            params.push(query.scope);
        }
        if (query.fact_type) {
            clauses.push('fact_type = ?');
            params.push(normalizeEnumValue(query.fact_type, FACT_TYPES, 'fact_type'));
        }
        if (query.actionability) {
            clauses.push('actionability = ?');
            params.push(normalizeEnumValue(query.actionability, FACT_ACTIONABILITIES, 'actionability'));
        }
        if (scope.publishedOnly) {
            clauses.push("registry_channel = 'published'");
        } else if (query.registry_channel) {
            clauses.push('registry_channel = ?');
            params.push(normalizeEnumValue(query.registry_channel, FACT_REGISTRY_CHANNELS, 'registry_channel'));
        } else if (query.local_agent) {
            const placeholders = LOCAL_AGENT_CHANNELS.map(() => '?').join(', ');
            clauses.push(`registry_channel IN (${placeholders})`);
            params.push(...LOCAL_AGENT_CHANNELS);
        } else if (query.published_only) {
            clauses.push("registry_channel = 'published'");
        }

        if (query.status) {
            clauses.push('status = ?');
            params.push(normalizeEnumValue(query.status, FACT_STATUSES, 'status'));
        } else if (!query.include_inactive) {
            clauses.push(query.include_review ? "status IN ('active', 'needs_review')" : "status = 'active'");
        }

        const rows = await db.all<FactRow>(`
          SELECT ${FACT_SELECT_COLUMNS}
          FROM facts
          WHERE ${clauses.join(' AND ')}
          ORDER BY updated_at DESC
        `, params);

        for (const row of rows) {
            const id = `${row.namespace}\0${row.key}`;
            if (seen.has(id)) continue;
            seen.add(id);
            allRows.push({ row, source: scope.source });
        }
    }

    const ranked: RelevantFactResult[] = [];
    for (const { row, source } of allRows) {
        const result = rankFact(row, profile, query);
        if (!result) continue;
        ranked.push({
            ...result,
            fact: {
                ...result.fact,
                lookup_source: source,
                writable: source === 'local'
            }
        });
    }
    ranked.sort((a, b) => b.relevance.score - a.relevance.score);
    const limited = ranked.slice(0, clampLimit(query.limit));

    return {
        profile,
        results: limited,
        count: limited.length
    };
}

export async function proposeFactFromProfile(registryName: string, profileId: string, namespace: string, key: string, input: InputRecord): Promise<UpsertFactResult> {
    const profileRow = await getAgentProfileRow(profileId);
    if (!profileRow) {
        throw new Error(`Agent profile '${profileId}' not found`);
    }

    const profile = agentProfileFromRow(profileRow);
    if (!profile.can_propose_facts) {
        throw new Error(`Agent profile '${profileId}' is not allowed to propose facts`);
    }

    const factType = hasOwn(input, 'fact_type')
        ? normalizeEnumValue(input.fact_type, FACT_TYPES, 'fact_type')
        : 'insight_fact';

    if (profile.writable_fact_types.length > 0 && !matchesPattern(factType, profile.writable_fact_types)) {
        throw new Error(`Agent profile '${profileId}' cannot write fact type '${factType}'`);
    }

    const proposed: InputRecord = {
        ...input,
        fact_type: factType,
        created_by: hasOwn(input, 'created_by') ? input.created_by : profile.id,
        status: hasOwn(input, 'status') ? input.status : profile.can_approve_facts ? 'active' : 'needs_review',
        approval_status: hasOwn(input, 'approval_status')
            ? input.approval_status
            : profile.can_approve_facts ? 'approved' : 'pending',
        registry_channel: hasOwn(input, 'registry_channel')
            ? input.registry_channel
            : profile.can_approve_facts ? 'published' : 'proposed',
        _event: 'propose'
    };

    if (profile.can_approve_facts && !hasOwn(input, 'approved_by')) {
        proposed.approved_by = profile.id;
    }

    return upsertFact(registryName, namespace, key, proposed);
}

async function transitionFact(registryName: string, namespace: string, key: string, input: InputRecord): Promise<UpsertFactResult> {
    const existing = await getFactRow(registryName, namespace, key);
    if (!existing) {
        throw new Error(`Fact '${key}' not found in namespace '${namespace}'`);
    }

    return upsertFact(registryName, namespace, key, {
        ...input,
        value: hasOwn(input, 'value') ? input.value : existing.value,
        description: hasOwn(input, 'description') ? input.description : existing.description,
        fact_type: hasOwn(input, 'fact_type') ? input.fact_type : existing.fact_type,
        subject: hasOwn(input, 'subject') ? input.subject : existing.subject,
        scope: hasOwn(input, 'scope') ? input.scope : existing.scope,
        derivation: hasOwn(input, 'derivation') ? input.derivation : existing.derivation,
        confidence: hasOwn(input, 'confidence') ? input.confidence : existing.confidence,
        source: hasOwn(input, 'source') ? input.source : existing.source,
        evidence: hasOwn(input, 'evidence') ? input.evidence : existing.evidence,
        valid_from: hasOwn(input, 'valid_from') ? input.valid_from : existing.valid_from,
        valid_until: hasOwn(input, 'valid_until') ? input.valid_until : existing.valid_until,
        observed_at: hasOwn(input, 'observed_at') ? input.observed_at : existing.observed_at,
        time_period: hasOwn(input, 'time_period') ? input.time_period : existing.time_period,
        audience: hasOwn(input, 'audience') ? input.audience : parseStringList(existing.audience),
        relevance_tags: hasOwn(input, 'relevance_tags') ? input.relevance_tags : parseStringList(existing.relevance_tags),
        actionability: hasOwn(input, 'actionability') ? input.actionability : existing.actionability,
        owner: hasOwn(input, 'owner') ? input.owner : existing.owner,
        priority: hasOwn(input, 'priority') ? input.priority : existing.priority,
        related_facts: hasOwn(input, 'related_facts') ? input.related_facts : parseStringList(existing.related_facts),
        created_by: hasOwn(input, 'created_by') ? input.created_by : existing.created_by,
        approved_by: hasOwn(input, 'approved_by') ? input.approved_by : existing.approved_by,
        approval_status: hasOwn(input, 'approval_status') ? input.approval_status : existing.approval_status,
        registry_channel: hasOwn(input, 'registry_channel') ? input.registry_channel : existing.registry_channel,
        published_at: hasOwn(input, 'published_at') ? input.published_at : existing.published_at,
        published_by: hasOwn(input, 'published_by') ? input.published_by : existing.published_by,
        change_reason: hasOwn(input, 'change_reason') ? input.change_reason : existing.change_reason,
        supersedes: hasOwn(input, 'supersedes') ? input.supersedes : existing.supersedes,
        superseded_by: hasOwn(input, 'superseded_by') ? input.superseded_by : existing.superseded_by,
        _event: input._event
    });
}

export async function reviewFact(registryName: string, namespace: string, key: string, input: InputRecord): Promise<UpsertFactResult> {
    const approved = hasOwn(input, 'approved') ? normalizeBoolean(input.approved, 'approved') : true;
    const reviewer = normalizeNullableString(input.reviewed_by ?? input.approved_by, 'reviewed_by');

    return transitionFact(registryName, namespace, key, {
        ...input,
        registry_channel: approved ? 'review' : 'retracted',
        status: approved ? 'needs_review' : 'retracted',
        approval_status: approved ? 'approved' : 'rejected',
        approved_by: reviewer,
        _event: 'review'
    });
}

export async function publishFact(registryName: string, namespace: string, key: string, input: InputRecord): Promise<UpsertFactResult> {
    const now = Date.now();
    const publisher = normalizeNullableString(input.published_by ?? input.approved_by, 'published_by');

    return transitionFact(registryName, namespace, key, {
        ...input,
        registry_channel: 'published',
        status: 'active',
        approval_status: 'approved',
        approved_by: hasOwn(input, 'approved_by') ? input.approved_by : publisher,
        published_by: publisher,
        published_at: hasOwn(input, 'published_at') ? input.published_at : now,
        _event: 'publish'
    });
}

/** Owner opens a fact for shared comments — visible to local agents, not production truth. */
export async function feedbackFact(registryName: string, namespace: string, key: string, input: InputRecord): Promise<UpsertFactResult> {
    const actor = normalizeNullableString(
        input.published_by ?? input.approved_by ?? input.reviewed_by ?? input.created_by,
        'published_by'
    );

    return transitionFact(registryName, namespace, key, {
        ...input,
        registry_channel: 'feedback',
        status: 'needs_review',
        approval_status: 'pending',
        approved_by: actor,
        change_reason: hasOwn(input, 'change_reason') ? input.change_reason : 'Opened for feedback',
        _event: 'feedback'
    });
}

export async function retractFact(registryName: string, namespace: string, key: string, input: InputRecord): Promise<UpsertFactResult> {
    return transitionFact(registryName, namespace, key, {
        ...input,
        registry_channel: 'retracted',
        status: 'retracted',
        approval_status: hasOwn(input, 'approval_status') ? input.approval_status : 'rejected',
        _event: 'retract'
    });
}

export async function supersedeFact(registryName: string, namespace: string, key: string, input: InputRecord): Promise<UpsertFactResult> {
    const supersededBy = normalizeRequiredString(input.superseded_by, 'superseded_by');

    return transitionFact(registryName, namespace, key, {
        ...input,
        registry_channel: 'superseded',
        status: 'superseded',
        superseded_by: supersededBy,
        _event: 'supersede'
    });
}

export async function pullFactsForAgent(query: RelevantFactQuery): Promise<{ profile: AgentProfileResponse | null; results: RelevantFactResult[]; count: number }> {
    // Production default: published only. Pass local_agent: true for local/dev agents.
    if (query.local_agent) {
        return findRelevantFacts({
            ...query,
            local_agent: true,
            published_only: false
        });
    }
    return findRelevantFacts({
        ...query,
        published_only: query.published_only ?? true
    });
}

export interface ReviewQueueQuery {
    registry_name: string;
    namespace?: string;
    limit?: number;
}

export interface ReviewQueueResult {
    facts: FactResponse[];
    count: number;
}

export interface RegistryMetadata {
    service: 'unifact';
    registry_id: string;
    role: string;
    tenant_isolation: string;
    capabilities: string[];
    upstream: {
        configured: boolean;
        url: string | null;
        role: string;
        source: string;
    };
    deployment?: {
        provider?: string;
    };
}

export async function listReviewQueue(query: ReviewQueueQuery): Promise<ReviewQueueResult> {
    const clauses = ["registry_name = ?", "registry_channel IN ('proposed', 'review', 'feedback')"];
    const params: unknown[] = [query.registry_name];

    if (query.namespace) {
        clauses.push('namespace = ?');
        params.push(query.namespace);
    }

    const rows = await db.all<FactRow>(`
      SELECT ${FACT_SELECT_COLUMNS}
      FROM facts
      WHERE ${clauses.join(' AND ')}
      ORDER BY
        CASE priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          ELSE 3
        END,
        updated_at DESC
      LIMIT ?
    `, [...params, clampLimit(query.limit)]);

    const facts = rows.map(factFromRow);
    return {
        facts,
        count: facts.length
    };
}

export async function approveFact(registryName: string, namespace: string, key: string, input: InputRecord): Promise<UpsertFactResult> {
    const reviewer = normalizeNullableString(
        input.reviewed_by ?? input.approved_by ?? input.published_by,
        'reviewed_by'
    );

    await reviewFact(registryName, namespace, key, {
        ...input,
        approved: true,
        reviewed_by: reviewer,
        approved_by: reviewer
    });

    return publishFact(registryName, namespace, key, {
        ...input,
        approved_by: reviewer,
        published_by: hasOwn(input, 'published_by') ? input.published_by : reviewer
    });
}

export async function rejectFact(registryName: string, namespace: string, key: string, input: InputRecord): Promise<UpsertFactResult> {
    const reviewer = normalizeNullableString(input.reviewed_by ?? input.approved_by, 'reviewed_by');

    return transitionFact(registryName, namespace, key, {
        ...input,
        registry_channel: 'retracted',
        status: 'retracted',
        approval_status: 'rejected',
        approved_by: reviewer,
        _event: 'retract'
    });
}

export async function getRegistryMetadata(): Promise<RegistryMetadata> {
    const config = await getSyncConfig();
    const provider = normalizeNullableString(process.env.UNIFACT_DEPLOYMENT_PROVIDER, 'UNIFACT_DEPLOYMENT_PROVIDER');
    const metadata: RegistryMetadata = {
        service: 'unifact',
        registry_id: process.env.UNIFACT_REGISTRY_ID || 'local',
        role: process.env.UNIFACT_REGISTRY_ROLE || 'local',
        tenant_isolation: process.env.UNIFACT_TENANT_ISOLATION || 'single_tenant',
        capabilities: [
            'propose',
            'review',
            'approve',
            'reject',
            'publish',
            'pull_published',
            'version_history'
        ],
        upstream: {
            configured: config.enabled,
            url: config.upstreamUrl,
            role: config.role,
            source: config.source
        }
    };

    if (provider) {
        metadata.deployment = { provider };
    }

    return metadata;
}

export interface SyncPullResult {
    success: boolean;
    pulled: number;
    skipped: number;
    conflicts: number;
    facts: FactResponse[];
}

export interface SyncPushResult {
    success: boolean;
    pushed: number;
    failed: number;
    facts: FactResponse[];
}

export type PushSelector =
    | { kind: 'namespace'; namespace: string }
    | { kind: 'exact'; namespace: string; key: string }
    | { kind: 'glob'; namespace: string; keyGlob: string };

/** Parse `policy`, `policy/feeling_talk`, or `policy/feeling_*`. */
export function parsePushSelector(token: string): PushSelector {
    const raw = token.trim();
    if (!raw) {
        throw new Error('Empty push selector');
    }
    const slash = raw.indexOf('/');
    if (slash === -1) {
        return { kind: 'namespace', namespace: raw };
    }
    const namespace = raw.slice(0, slash);
    const keyPart = raw.slice(slash + 1);
    if (!namespace || !keyPart) {
        throw new Error(`Invalid push selector '${raw}' (use namespace, namespace/key, or namespace/pattern*)`);
    }
    if (keyPart.includes('*') || keyPart.includes('?')) {
        return { kind: 'glob', namespace, keyGlob: keyPart };
    }
    return { kind: 'exact', namespace, key: keyPart };
}

function keyMatchesGlob(key: string, glob: string): boolean {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`).test(key);
}

function factMatchesSelector(
    fact: { namespace: string; key: string },
    selector: PushSelector
): boolean {
    if (fact.namespace !== selector.namespace) return false;
    if (selector.kind === 'namespace') return true;
    if (selector.kind === 'exact') return fact.key === selector.key;
    return keyMatchesGlob(fact.key, selector.keyGlob);
}

export interface SyncStatusResult {
    enabled: boolean;
    upstreamUrl: string | null;
    remoteUrl: string | null;
    role: string;
    branch: string;
    source: string;
    localFacts: number;
    reviewQueue: number;
    lastSync: number | null;
}

/** Resolve registry for pull/push from API key or active-registry fact. */
async function resolveSyncRegistryName(person: string | null, apiKey: string | null): Promise<string> {
    if (apiKey) {
        const keyRecord = await findApiKeyBySecret(apiKey);
        if (keyRecord?.registry_name) return keyRecord.registry_name;
    }
    if (person) {
        const keys = await listApiKeys();
        const match = keys.find((k) => k.person === person);
        if (match?.registry_name) return match.registry_name;
    }
    const row = await db.get<{ value: string }>(`
      SELECT value FROM facts
      WHERE namespace = 'company.infrastructure' AND key = 'active-registry'
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    const fromFact = row?.value?.trim();
    if (fromFact) return fromFact;
    throw new Error('No active registry. uni init <Registry> or uni join …');
}

/**
 * Pull published facts from origin.
 * Never pulls API keys — membership keys are push-only (via uni approve / uni suspend).
 */
export async function pullFactsFromRemote(namespaces?: string[]): Promise<SyncPullResult> {
    const config = await getSyncConfig();
    if (!config.enabled || !config.upstreamUrl || !config.apiKey) {
        throw new Error('Upstream registry not configured. Set company.infrastructure/upstream-registry-url and create an enabled API key (uni key create --person you).');
    }

    const remoteUrl = await getRemoteBranchUrl();
    if (!remoteUrl) {
        throw new Error('Could not determine remote URL');
    }

    const registryName = await resolveSyncRegistryName(config.person, config.apiKey);

    try {
        const targetNamespaces = namespaces || [
            'company.guidelines',
            'company.branding',
            'company.decisions',
            'company.constraints'
        ];
        let pulled = 0;
        let skipped = 0;
        let conflicts = 0;
        const pulledFacts: FactResponse[] = [];

        for (const namespace of targetNamespaces) {
            const response = await fetch(
                `${remoteUrl}/v1/registries/${encodeURIComponent(registryName)}/facts/${encodeURIComponent(namespace)}?include_metadata=true&registry_channel=published`,
                {
                headers: {
                    'X-API-Key': config.apiKey,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                const detail = await response.text().catch(() => '');
                const hint = detail.slice(0, 200) || response.statusText;
                console.warn(`Failed to pull namespace ${namespace}: ${response.status} ${hint}`);
                if (response.status === 401) {
                    console.warn(
                        '  Hint: local API key secret does not match origin. Install the origin key or re-init with a new person.'
                    );
                } else if (response.status === 403) {
                    console.warn(
                        '  Hint: this key is known on origin but is not allowed to read that namespace.'
                    );
                }
                continue;
            }

            const data = await response.json();
            const remoteFacts = Array.isArray(data) ? data : (data.facts || []);

            for (const remoteFact of remoteFacts) {
                const existing = await getFactRow(registryName, remoteFact.namespace, remoteFact.key);

                if (existing) {
                    if (existing.version >= remoteFact.version) {
                        skipped++;
                        continue;
                    }
                    if (existing.updated_at >= remoteFact.updated_at) {
                        conflicts++;
                        continue;
                    }
                }

                const result = await upsertFact(registryName, remoteFact.namespace, remoteFact.key, remoteFact);
                pulled++;
                pulledFacts.push(result.fact);
            }
        }

        return {
            success: true,
            pulled,
            skipped,
            conflicts,
            facts: pulledFacts
        };
    } catch (error) {
        throw new Error(`Pull failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export interface PushCollaborationContext {
    solo: boolean;
    isOwner: boolean;
    person: string | null;
    memberCount: number;
    registryName: string | null;
}

/** Solo = at most one enabled person key. Owner = matches person's registry owner_person. */
export async function getPushCollaborationContext(
    person: string | null
): Promise<PushCollaborationContext> {
    const keys = await listApiKeys();
    const members = new Set(keys.filter((k) => k.enabled).map((k) => k.person));
    if (person) members.add(person);
    const memberCount = members.size;

    let registryName: string | null = null;
    if (person) {
        const key = keys.find((k) => k.person === person);
        registryName = key?.registry_name ?? null;
    }
    if (!registryName) {
        const row = await db.get<{ value: string }>(`
          SELECT value FROM facts
          WHERE namespace = 'company.infrastructure' AND key = 'active-registry'
          ORDER BY updated_at DESC
          LIMIT 1
        `);
        registryName = row?.value?.trim() || null;
    }

    const registry = registryName
        ? await db.get<{ name: string; owner_person: string }>(`
            SELECT name, owner_person FROM registries WHERE lower(name) = lower(?)
          `, [registryName])
        : null;

    const isOwner = registry ? !person || registry.owner_person === person : true;

    return {
        solo: memberCount <= 1,
        isOwner,
        person,
        memberCount,
        registryName: registry?.name ?? registryName
    };
}

function remoteChannelForPush(
    localChannel: string,
    ctx: PushCollaborationContext
): 'proposed' | 'review' | 'feedback' | 'published' {
    if (ctx.solo) {
        // Single-user registry: sync channel as-is (working → proposed).
        if (localChannel === 'working') return 'proposed';
        if (localChannel === 'published') return 'published';
        if (localChannel === 'feedback') return 'feedback';
        if (localChannel === 'review') return 'review';
        return 'proposed';
    }

    // Multi-user: push is never a direct remote publish.
    // Owner → feedback (owner reviews, then uni publish). Others → review.
    if (localChannel === 'published') {
        // Re-syncing already-published truth keeps published.
        return 'published';
    }
    if (!ctx.isOwner) {
        return 'review';
    }
    if (localChannel === 'review') return 'review';
    if (localChannel === 'feedback') return 'feedback';
    return 'feedback';
}

/**
 * Push local facts upstream.
 * @param selectors - tokens like `policy`, `policy/feeling_talk`, `policy/feeling_*`.
 *   Empty / omitted = all local namespaces allowed by the active API key.
 */
export async function pushFactsToRemote(selectors?: string[]): Promise<SyncPushResult> {
    const config = await getSyncConfig();
    if (!config.enabled || !config.upstreamUrl || !config.apiKey) {
        throw new Error('Upstream registry not configured. Set company.infrastructure/upstream-registry-url and create an enabled API key (uni key create --person you).');
    }

    const remoteUrl = await getRemoteBranchUrl();
    if (!remoteUrl) {
        throw new Error('Could not determine remote URL');
    }

    const registryName = await resolveSyncRegistryName(config.person, config.apiKey);

    // Push only to the active/home registry — never to lookup-path parents.
    if (config.person) {
        await assertCanWriteRegistry(config.person, registryName);
    }

    try {
        const keyRecord = await findApiKeyBySecret(config.apiKey);
        const ctx = await getPushCollaborationContext(config.person);
        const parsed: PushSelector[] =
            selectors && selectors.length > 0
                ? selectors.map(parsePushSelector)
                : (await listFactNamespaces(registryName)).map((namespace) => ({
                      kind: 'namespace' as const,
                      namespace
                  }));

        const allowed = parsed.filter((sel) => apiKeyAllowsNamespace(keyRecord, sel.namespace));
        if (allowed.length === 0) {
            return { success: true, pushed: 0, failed: 0, facts: [] };
        }

        const pushableChannels = new Set([
            'working',
            'proposed',
            'review',
            'feedback',
            'published'
        ]);

        const namespaces = [...new Set(allowed.map((s) => s.namespace))];
        let pushed = 0;
        let failed = 0;
        const pushedFacts: FactResponse[] = [];

        for (const namespace of namespaces) {
            const nsSelectors = allowed.filter((s) => s.namespace === namespace);
            const localFacts = (await listFacts(registryName, namespace)).filter(
                (f) =>
                    pushableChannels.has(f.registry_channel) &&
                    nsSelectors.some((sel) => factMatchesSelector(f, sel))
            );

            for (const fact of localFacts) {
                try {
                    const base = factFromRow(fact);
                    const remoteChannel = remoteChannelForPush(fact.registry_channel, ctx);
                    const payload =
                        remoteChannel === 'published'
                            ? {
                                  ...base,
                                  registry_channel: 'published',
                                  approval_status: 'approved',
                                  status: 'active',
                                  published_by: base.published_by || base.approved_by || base.created_by,
                                  published_at: base.published_at || Date.now()
                              }
                            : {
                                  ...base,
                                  registry_channel: remoteChannel,
                                  approval_status: 'pending',
                                  status: remoteChannel === 'review' || remoteChannel === 'feedback'
                                      ? 'needs_review'
                                      : fact.status === 'active'
                                        ? 'needs_review'
                                        : fact.status,
                                  published_by: null,
                                  published_at: null
                              };

                    const response = await fetch(
                        `${remoteUrl}/v1/registries/${encodeURIComponent(registryName)}/facts/${encodeURIComponent(fact.namespace)}/${encodeURIComponent(fact.key)}`,
                        {
                            method: 'PUT',
                            headers: {
                                'X-API-Key': config.apiKey,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(payload)
                        }
                    );

                    if (!response.ok) {
                        const detail = await response.text().catch(() => '');
                        console.warn(
                            `Failed to push ${fact.namespace}/${fact.key}: ${response.status} ${response.statusText}${detail ? ` — ${detail.slice(0, 200)}` : ''}`
                        );
                        failed++;
                        continue;
                    }

                    pushed++;
                    pushedFacts.push({ ...base, registry_channel: remoteChannel });
                } catch (error) {
                    console.warn(`Error pushing ${fact.namespace}/${fact.key}:`, error);
                    failed++;
                }
            }
        }

        return {
            success: true,
            pushed,
            failed,
            facts: pushedFacts
        };
    } catch (error) {
        throw new Error(`Push failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function getSyncStatus(): Promise<SyncStatusResult> {
    const config = await getSyncConfig();
    let registryName: string | null = null;
    try {
        registryName = await resolveSyncRegistryName(config.person, config.apiKey);
    } catch {
        registryName = null;
    }

    const localCount = registryName
        ? await db.get<{ count: number }>('SELECT COUNT(*) as count FROM facts WHERE registry_name = ?', [registryName])
        : await db.get<{ count: number }>('SELECT COUNT(*) as count FROM facts');
    const reviewQueue = registryName
        ? await db.get<{ count: number }>(`
            SELECT COUNT(*) as count
            FROM facts
            WHERE registry_name = ?
              AND registry_channel IN ('proposed', 'review', 'feedback')
          `, [registryName])
        : await db.get<{ count: number }>(`
            SELECT COUNT(*) as count
            FROM facts
            WHERE registry_channel IN ('proposed', 'review', 'feedback')
          `);

    return {
        enabled: config.enabled,
        upstreamUrl: config.upstreamUrl,
        remoteUrl: config.remoteUrl,
        role: config.role,
        branch: config.branch,
        source: config.source,
        localFacts: localCount?.count ?? 0,
        reviewQueue: reviewQueue?.count ?? 0,
        lastSync: null
    };
}

export interface AuditExportRow {
    id: number;
    registry_name: string;
    action: string;
    namespace: string;
    key: string;
    old_value: string | null;
    new_value: string | null;
    timestamp: number;
    timestamp_iso: string;
}

export async function exportAuditLog(
    registryName: string,
    options?: { limit?: number; since?: number }
): Promise<AuditExportRow[]> {
    const limit = Math.min(Math.max(options?.limit ?? 500, 1), 5000);
    const since = options?.since;
    const rows = since
        ? await db.all<AuditLogRow>(
              `
          SELECT id, action, registry_name, namespace, key, old_value, new_value,
                 old_snapshot, new_snapshot, timestamp
          FROM audit_log
          WHERE registry_name = ? AND timestamp >= ?
          ORDER BY timestamp DESC
          LIMIT ?
        `,
              [registryName, since, limit]
          )
        : await db.all<AuditLogRow>(
              `
          SELECT id, action, registry_name, namespace, key, old_value, new_value,
                 old_snapshot, new_snapshot, timestamp
          FROM audit_log
          WHERE registry_name = ?
          ORDER BY timestamp DESC
          LIMIT ?
        `,
              [registryName, limit]
          );

    return rows.map((row) => ({
        id: row.id,
        registry_name: row.registry_name || registryName,
        action: row.action,
        namespace: row.namespace,
        key: row.key,
        old_value: row.old_value,
        new_value: row.new_value,
        timestamp: row.timestamp,
        timestamp_iso: new Date(row.timestamp).toISOString()
    }));
}

export function formatAuditExportCsv(rows: AuditExportRow[]): string {
    const header = [
        'id',
        'registry_name',
        'action',
        'namespace',
        'key',
        'old_value',
        'new_value',
        'timestamp',
        'timestamp_iso'
    ];
    const escape = (v: string | number | null) => {
        const s = v == null ? '' : String(v);
        if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    };
    const lines = [header.join(',')];
    for (const row of rows) {
        lines.push(
            [
                row.id,
                row.registry_name,
                row.action,
                row.namespace,
                row.key,
                row.old_value,
                row.new_value,
                row.timestamp,
                row.timestamp_iso
            ]
                .map(escape)
                .join(',')
        );
    }
    return lines.join('\n') + '\n';
}

import { db, AgentProfileRow, FactRow } from './db.js';
import {
    AgentProfileResponse,
    FACT_ACTIONABILITIES,
    FACT_APPROVAL_STATUSES,
    FACT_DERIVATIONS,
    FACT_PRIORITIES,
    FACT_STATUSES,
    FACT_TYPES,
    FactResponse,
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

export const FACT_SELECT_COLUMNS = `
  rowid, namespace, key, value, description, fact_type, subject, scope, status,
  derivation, confidence, source, evidence, valid_from, valid_until,
  observed_at, time_period, audience, relevance_tags, actionability, owner,
  priority, related_facts, created_by, approved_by, approval_status,
  created_at, updated_at
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
            : existing?.approval_status ?? 'unreviewed'
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

export function getFactRow(namespace: string, key: string): FactRow | undefined {
    return db.prepare(`
      SELECT ${FACT_SELECT_COLUMNS}
      FROM facts
      WHERE namespace = ? AND key = ?
    `).get(namespace, key) as FactRow | undefined;
}

export function listFacts(namespace: string): FactRow[] {
    return db.prepare(`
      SELECT ${FACT_SELECT_COLUMNS}
      FROM facts
      WHERE namespace = ?
      ORDER BY key
    `).all(namespace) as FactRow[];
}

export function searchFacts(query: string): FactRow[] {
    return db.prepare(`
      SELECT ${FACT_SELECT_COLUMNS}
      FROM facts
      WHERE rowid IN (
        SELECT rowid FROM facts_fts WHERE facts_fts MATCH ?
      )
      ORDER BY namespace, key
    `).all(query) as FactRow[];
}

export function upsertFact(namespace: string, key: string, input: InputRecord): UpsertFactResult {
    const storedValue = serializeValue(input.value);
    const now = Date.now();
    const existing = getFactRow(namespace, key);
    const columns = buildFactColumns(input, existing);
    const action: 'CREATE' | 'UPDATE' = existing ? 'UPDATE' : 'CREATE';
    const oldSnapshot = existing ? JSON.stringify(factFromRow(existing)) : null;

    const saved = db.transaction(() => {
        if (existing) {
            db.prepare(`
              UPDATE facts
              SET value = ?, description = ?, fact_type = ?, subject = ?, scope = ?,
                  status = ?, derivation = ?, confidence = ?, source = ?, evidence = ?,
                  valid_from = ?, valid_until = ?, observed_at = ?, time_period = ?,
                  audience = ?, relevance_tags = ?, actionability = ?, owner = ?,
                  priority = ?, related_facts = ?, created_by = ?, approved_by = ?,
                  approval_status = ?, updated_at = ?
              WHERE namespace = ? AND key = ?
            `).run(
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
                now,
                namespace,
                key
            );
        } else {
            db.prepare(`
              INSERT INTO facts (
                namespace, key, value, description, fact_type, subject, scope,
                status, derivation, confidence, source, evidence, valid_from,
                valid_until, observed_at, time_period, audience, relevance_tags,
                actionability, owner, priority, related_facts, created_by,
                approved_by, approval_status, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
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
                now,
                now
            );
        }

        const savedRow = getFactRow(namespace, key);
        if (!savedRow) {
            throw new Error(`Failed to load saved fact '${namespace}/${key}'`);
        }

        db.prepare(`
          INSERT INTO audit_log (
            action, namespace, key, old_value, new_value, old_snapshot,
            new_snapshot, timestamp
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            action,
            namespace,
            key,
            existing?.value ?? null,
            storedValue,
            oldSnapshot,
            JSON.stringify(factFromRow(savedRow)),
            now
        );

        return savedRow;
    })() as FactRow;

    return {
        success: true,
        action,
        fact: factFromRow(saved)
    };
}

export function deleteFact(namespace: string, key: string): boolean {
    const existing = getFactRow(namespace, key);
    if (!existing) {
        return false;
    }

    const now = Date.now();
    db.transaction(() => {
        db.prepare('DELETE FROM facts WHERE namespace = ? AND key = ?').run(namespace, key);
        db.prepare(`
          INSERT INTO audit_log (
            action, namespace, key, old_value, new_value, old_snapshot,
            new_snapshot, timestamp
          )
          VALUES ('DELETE', ?, ?, ?, NULL, ?, NULL, ?)
        `).run(namespace, key, existing.value, JSON.stringify(factFromRow(existing)), now);
    })();

    return true;
}

export function getAgentProfileRow(id: string): AgentProfileRow | undefined {
    return db.prepare(`
      SELECT ${AGENT_PROFILE_SELECT_COLUMNS}
      FROM agent_profiles
      WHERE id = ?
    `).get(id) as AgentProfileRow | undefined;
}

export function listAgentProfiles(): AgentProfileResponse[] {
    const rows = db.prepare(`
      SELECT ${AGENT_PROFILE_SELECT_COLUMNS}
      FROM agent_profiles
      ORDER BY name
    `).all() as AgentProfileRow[];

    return rows.map(agentProfileFromRow);
}

export function upsertAgentProfile(id: string, input: InputRecord): UpsertAgentProfileResult {
    const now = Date.now();
    const existing = getAgentProfileRow(id);
    const columns = buildAgentProfileColumns(id, input, existing);
    const action: 'CREATE' | 'UPDATE' = existing ? 'UPDATE' : 'CREATE';

    const saved = db.transaction(() => {
        if (existing) {
            db.prepare(`
              UPDATE agent_profiles
              SET name = ?, description = ?, role = ?, allowed_fact_types = ?,
                  writable_fact_types = ?, relevant_scopes = ?, relevant_subjects = ?,
                  intents = ?, audience_tags = ?, can_propose_facts = ?,
                  can_approve_facts = ?, allowed_actions = ?,
                  requires_human_approval_for = ?, updated_at = ?
              WHERE id = ?
            `).run(
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
            );
        } else {
            db.prepare(`
              INSERT INTO agent_profiles (
                id, name, description, role, allowed_fact_types,
                writable_fact_types, relevant_scopes, relevant_subjects, intents,
                audience_tags, can_propose_facts, can_approve_facts,
                allowed_actions, requires_human_approval_for, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
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
            );
        }

        const savedRow = getAgentProfileRow(id);
        if (!savedRow) {
            throw new Error(`Failed to load saved agent profile '${id}'`);
        }
        return savedRow;
    })() as AgentProfileRow;

    return {
        success: true,
        action,
        profile: agentProfileFromRow(saved)
    };
}

export function deleteAgentProfile(id: string): boolean {
    const existing = getAgentProfileRow(id);
    if (!existing) {
        return false;
    }

    db.prepare('DELETE FROM agent_profiles WHERE id = ?').run(id);
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

export function findRelevantFacts(query: RelevantFactQuery): { profile: AgentProfileResponse | null; results: RelevantFactResult[]; count: number } {
    const profileRow = query.profile_id ? getAgentProfileRow(query.profile_id) : undefined;
    if (query.profile_id && !profileRow) {
        throw new Error(`Agent profile '${query.profile_id}' not found`);
    }

    const profile = profileRow ? agentProfileFromRow(profileRow) : null;
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (query.query) {
        clauses.push('rowid IN (SELECT rowid FROM facts_fts WHERE facts_fts MATCH ?)');
        params.push(query.query);
    }
    if (query.namespace) {
        clauses.push('namespace = ?');
        params.push(query.namespace);
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
    if (query.status) {
        clauses.push('status = ?');
        params.push(normalizeEnumValue(query.status, FACT_STATUSES, 'status'));
    } else if (!query.include_inactive) {
        clauses.push(query.include_review ? "status IN ('active', 'needs_review')" : "status = 'active'");
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT ${FACT_SELECT_COLUMNS}
      FROM facts
      ${where}
      ORDER BY updated_at DESC
    `).all(...params) as FactRow[];

    const ranked = rows
        .map(row => rankFact(row, profile, query))
        .filter((result): result is RelevantFactResult => result !== null)
        .sort((a, b) => b.relevance.score - a.relevance.score)
        .slice(0, clampLimit(query.limit));

    return {
        profile,
        results: ranked,
        count: ranked.length
    };
}

export function proposeFactFromProfile(profileId: string, namespace: string, key: string, input: InputRecord): UpsertFactResult {
    const profileRow = getAgentProfileRow(profileId);
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
            : profile.can_approve_facts ? 'approved' : 'pending'
    };

    if (profile.can_approve_facts && !hasOwn(input, 'approved_by')) {
        proposed.approved_by = profile.id;
    }

    return upsertFact(namespace, key, proposed);
}
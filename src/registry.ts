import { randomUUID } from 'crypto';
import { db, type JoinRequestRow, type RegistryRow } from './db.js';
import { createApiKey, getApiKeyByPerson, setApiKeyEnabled, type ApiKeyRecord } from './keys.js';
import { getMetadataFromGitUrl } from './git-metadata.js';
import { pullFactsFromRemote, upsertFact } from './store.js';
import { getRemoteBranchUrl, pushPersonKeyToRemote, type RemoteKeyPushResult } from './sync.js';
import { assertRegistryNameAvailable } from './naming.js';
import { namespaceChain } from './namespaces.js';

export interface RegistryRecord {
    id: string;
    name: string;
    owner_person: string;
    description: string | null;
    git_url: string | null;
    parent_registry: string | null;
    lookup_visibility: 'private' | 'org';
    created_at: number;
    updated_at: number;
}

export interface JoinRequestRecord {
    id: string;
    registry_name: string;
    person: string;
    status: 'pending' | 'approved' | 'rejected' | 'suspended';
    message: string | null;
    created_at: number;
    updated_at: number;
}

export function normalizeRegistryName(name: string): string {
    const cleaned = name.trim().replace(/^\/+|\/+$/g, '');
    if (!cleaned) {
        throw new Error('Registry name is required');
    }
    // Allow Unifact, acme-corp, org names with letters/numbers/._-
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(cleaned)) {
        throw new Error('Registry name must be 1–64 chars: letters, numbers, . _ -');
    }
    return cleaned;
}

/** Parse `host/Registry` or just `Registry`. */
export function parseJoinTarget(target: string): { host: string | null; registry: string } {
    const raw = target.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const slash = raw.indexOf('/');
    if (slash === -1) {
        return { host: null, registry: normalizeRegistryName(raw) };
    }
    const host = raw.slice(0, slash).trim();
    const registry = normalizeRegistryName(raw.slice(slash + 1));
    return { host: host || null, registry };
}

function registryNamespaces(registryName: string): string[] {
    const slug = registryName.toLowerCase();
    return [`${slug}.*`, 'company.*', '*'];
}

function toRegistry(row: RegistryRow): RegistryRecord {
    const visibility = row.lookup_visibility === 'org' ? 'org' : 'private';
    return {
        id: row.id,
        name: row.name,
        owner_person: row.owner_person,
        description: row.description,
        git_url: row.git_url,
        parent_registry: row.parent_registry ?? null,
        lookup_visibility: visibility,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

function toJoinRequest(row: JoinRequestRow): JoinRequestRecord {
    const status =
        row.status === 'approved' ||
        row.status === 'rejected' ||
        row.status === 'suspended'
            ? row.status
            : 'pending';
    return {
        id: row.id,
        registry_name: row.registry_name,
        person: row.person,
        status,
        message: row.message,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

export async function listRegistries(): Promise<RegistryRecord[]> {
    const rows = await db.all<RegistryRow>('SELECT * FROM registries ORDER BY name ASC');
    return rows.map(toRegistry);
}

export async function getRegistry(name: string): Promise<RegistryRecord | undefined> {
    const normalized = normalizeRegistryName(name);
    const row = await db.get<RegistryRow>('SELECT * FROM registries WHERE lower(name) = lower(?)', [normalized]);
    return row ? toRegistry(row) : undefined;
}

/** Canonical registry row — join/approve always store this exact `name`. */
async function requireRegistry(name: string): Promise<RegistryRecord> {
    const registry = await getRegistry(name);
    if (!registry) {
        throw new Error(`Registry '${normalizeRegistryName(name)}' not found`);
    }
    return registry;
}

export async function listJoinRequests(registryName?: string): Promise<JoinRequestRecord[]> {
    const rows = registryName
        ? await db.all<JoinRequestRow>(
              'SELECT * FROM join_requests WHERE lower(registry_name) = lower(?) ORDER BY created_at ASC',
              [normalizeRegistryName(registryName)]
          )
        : await db.all<JoinRequestRow>('SELECT * FROM join_requests ORDER BY created_at ASC');
    return rows.map(toJoinRequest);
}

export type PersonRegistryMembership = {
    registry: RegistryRecord;
    role: 'owner' | 'member';
    status: string;
};

/** Registries where person is owner or approved member (not pending/suspended). */
export async function listRegistriesForPerson(person: string): Promise<PersonRegistryMembership[]> {
    const name = person.trim();
    if (!name) return [];

    const all = await listRegistries();
    const out: PersonRegistryMembership[] = [];

    for (const registry of all) {
        if (registry.owner_person === name) {
            out.push({ registry, role: 'owner', status: 'owner' });
            continue;
        }
        const requests = await listJoinRequests(registry.name);
        const mine = requests.find((r) => r.person === name && r.status === 'approved');
        if (mine) {
            out.push({ registry, role: 'member', status: 'approved' });
        }
    }

    return out;
}

/** Owner or approved member of this registry (case-insensitive name). */
export async function getPersonMembership(
    person: string,
    registryName: string
): Promise<PersonRegistryMembership | undefined> {
    const mine = await listRegistriesForPerson(person);
    const want = normalizeRegistryName(registryName);
    return mine.find((m) => m.registry.name.toLowerCase() === want.toLowerCase());
}

export async function assertPersonMemberOfRegistry(
    person: string,
    registryName: string
): Promise<PersonRegistryMembership> {
    const membership = await getPersonMembership(person, registryName);
    if (!membership) {
        throw new Error(
            `Not a member of '${normalizeRegistryName(registryName)}'. Join first: uni join ${normalizeRegistryName(registryName)}`
        );
    }
    return membership;
}

/**
 * Writes (including push) are only allowed on registries the person belongs to.
 * Explicit namespace lookups are read-only — they do not grant write/push.
 */
export async function assertCanWriteRegistry(person: string, targetRegistry: string): Promise<void> {
    await assertPersonMemberOfRegistry(person, targetRegistry);
}

/** Org-public registries on this host (whole registry marked public). */
export async function listOrgPublicRegistries(): Promise<RegistryRecord[]> {
    const all = await listRegistries();
    return all.filter((r) => r.lookup_visibility === 'org');
}

/**
 * Owner sets whether the WHOLE registry is org-public for lookup/discovery.
 * Prefer per-namespace visibility (setNamespaceVisibility) so internal
 * namespaces (e.g. company.infrastructure) are not exposed. This coarse flag
 * exposes every published fact in the registry.
 */
export async function setLookupVisibility(input: {
    registry: string;
    visibility: 'private' | 'org';
    set_by: string;
}): Promise<RegistryRecord> {
    const registry = await requireRegistry(input.registry);
    if (registry.owner_person !== input.set_by.trim()) {
        throw new Error(`Only owner '${registry.owner_person}' can set lookup visibility for '${registry.name}'`);
    }
    const visibility = input.visibility === 'org' ? 'org' : 'private';
    const now = Date.now();
    await db.run(`UPDATE registries SET lookup_visibility = ?, updated_at = ? WHERE id = ?`, [
        visibility,
        now,
        registry.id
    ]);
    const updated = await getRegistry(registry.name);
    if (!updated) throw new Error('Failed to update lookup visibility');
    return updated;
}

export interface PublicNamespaceRecord {
    registry_name: string;
    namespace: string;
    created_at: number;
    updated_at: number;
}

async function ensurePublicNamespacesTable(): Promise<void> {
    await db.run(`
      CREATE TABLE IF NOT EXISTS public_namespaces (
        id TEXT PRIMARY KEY,
        registry_name TEXT NOT NULL,
        namespace TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(registry_name, namespace)
      )
    `);
}

/** Namespaces explicitly marked org-public (per registry, or all registries). */
export async function listPublicNamespaces(registryName?: string): Promise<PublicNamespaceRecord[]> {
    await ensurePublicNamespacesTable();
    const rows = registryName?.trim()
        ? await db.all<PublicNamespaceRecord>(
              `SELECT registry_name, namespace, created_at, updated_at FROM public_namespaces
               WHERE lower(registry_name) = lower(?) ORDER BY namespace ASC`,
              [normalizeRegistryName(registryName)]
          )
        : await db.all<PublicNamespaceRecord>(
              `SELECT registry_name, namespace, created_at, updated_at FROM public_namespaces
               ORDER BY registry_name ASC, namespace ASC`
          );
    return rows.map((r) => ({
        registry_name: r.registry_name,
        namespace: r.namespace,
        created_at: r.created_at,
        updated_at: r.updated_at
    }));
}

/** True if `namespace` (or an ancestor in its dotted chain) is org-public in registry. */
export async function isNamespacePublic(registryName: string, namespace: string): Promise<boolean> {
    const publics = await listPublicNamespaces(registryName);
    if (publics.length === 0) return false;
    const set = new Set(publics.map((p) => p.namespace));
    return namespaceChain(namespace).some((ns) => set.has(ns));
}

/**
 * Owner marks a namespace org-public (or private) for cross-registry lookup.
 * Publishing a namespace also opens its descendants (dotted hierarchy) for lookup.
 */
export async function setNamespaceVisibility(input: {
    registry: string;
    namespace: string;
    visibility: 'private' | 'org';
    set_by: string;
}): Promise<PublicNamespaceRecord[]> {
    await ensurePublicNamespacesTable();
    const registry = await requireRegistry(input.registry);
    if (registry.owner_person !== input.set_by.trim()) {
        throw new Error(
            `Only owner '${registry.owner_person}' can set namespace visibility for '${registry.name}'`
        );
    }
    const ns = input.namespace.trim();
    if (!ns) throw new Error('namespace is required');
    const now = Date.now();
    if (input.visibility === 'org') {
        const existing = await db.get<{ id: string }>(
            `SELECT id FROM public_namespaces WHERE lower(registry_name) = lower(?) AND namespace = ?`,
            [registry.name, ns]
        );
        if (!existing) {
            await db.run(
                `INSERT INTO public_namespaces (id, registry_name, namespace, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [randomUUID(), registry.name, ns, now, now]
            );
        }
    } else {
        await db.run(
            `DELETE FROM public_namespaces WHERE lower(registry_name) = lower(?) AND namespace = ?`,
            [registry.name, ns]
        );
    }
    return listPublicNamespaces(registry.name);
}

export type OrgPublicTarget = {
    registry: string;
    owner: string;
    description: string | null;
    whole_registry: boolean;
    namespaces: string[];
};

/** Everything lookable from other registries on this host (uni discover / GET /v1/discover). */
export async function listOrgPublicTargets(): Promise<OrgPublicTarget[]> {
    const registries = await listRegistries();
    const publics = await listPublicNamespaces();
    const byRegistry = new Map<string, string[]>();
    for (const p of publics) {
        const list = byRegistry.get(p.registry_name) ?? [];
        list.push(p.namespace);
        byRegistry.set(p.registry_name, list);
    }
    const out: OrgPublicTarget[] = [];
    for (const registry of registries) {
        const namespaces = (byRegistry.get(registry.name) ?? []).sort();
        const whole = registry.lookup_visibility === 'org';
        if (!whole && namespaces.length === 0) continue;
        out.push({
            registry: registry.name,
            owner: registry.owner_person,
            description: registry.description,
            whole_registry: whole,
            namespaces
        });
    }
    return out;
}

/**
 * May this person register a read-only lookup into targetRegistry/targetNamespace?
 * Allowed if the whole registry is org-public, the target namespace (or an
 * ancestor) is org-public, or the person is a member of the target registry.
 */
export async function assertCanLookupNamespace(
    person: string | null | undefined,
    targetRegistry: string,
    targetNamespace: string
): Promise<void> {
    const target = await requireRegistry(targetRegistry);
    if (target.lookup_visibility === 'org') return;
    if (await isNamespacePublic(target.name, targetNamespace)) return;
    if (person?.trim()) {
        const membership = await getPersonMembership(person, target.name);
        if (membership) return;
    }
    throw new Error(
        `Namespace '${target.name}/${targetNamespace}' is not open for lookup. ` +
            `Ask the owner to publish it (uni public ${targetNamespace} — run on '${target.name}'), ` +
            `or join the registry (uni join ${target.name}).`
    );
}

export interface TeamMemberView {
    person: string;
    role: 'owner' | 'member';
    status: 'approved' | 'pending' | 'rejected' | 'suspended' | 'owner';
    access: 'on' | 'off' | '—';
}

export interface TeamView {
    registry: string;
    owner: string;
    members: TeamMemberView[];
}

/** Owner + join-request roster for a registry (uni team). */
export async function getTeam(registryName: string): Promise<TeamView> {
    const registry = await getRegistry(registryName);
    if (!registry) {
        throw new Error(`Registry '${normalizeRegistryName(registryName)}' not found`);
    }

    const requests = await listJoinRequests(registry.name);

    const members: TeamMemberView[] = [
        {
            person: registry.owner_person,
            role: 'owner',
            status: 'owner',
            access: (await getApiKeyByPerson(registry.owner_person))?.enabled ? 'on' : 'off'
        }
    ];

    for (const req of requests) {
        if (req.person === registry.owner_person) continue;
        if (members.some((m) => m.person === req.person)) continue;
        const key = await getApiKeyByPerson(req.person);
        members.push({
            person: req.person,
            role: 'member',
            status: req.status,
            access: key ? (key.enabled ? 'on' : 'off') : '—'
        });
    }

    return {
        registry: registry.name,
        owner: registry.owner_person,
        members
    };
}

async function setActiveRegistryFact(registryName: string, upstreamUrl?: string | null): Promise<void> {
    await upsertFact(registryName, 'company.infrastructure', 'active-registry', {
        value: registryName,
        description: 'Local active UniFact org registry name',
        fact_type: 'decision_fact',
        registry_channel: 'published',
        approval_status: 'approved',
        published_by: 'uni',
        _event: 'publish'
    });
    if (upstreamUrl) {
        await upsertFact(registryName, 'company.infrastructure', 'upstream-registry-url', {
            value: upstreamUrl.replace(/\/$/, ''),
            description: 'Upstream UniFact host for pull/push',
            fact_type: 'decision_fact',
            registry_channel: 'published',
            approval_status: 'approved',
            published_by: 'uni',
            _event: 'publish'
        });
    }
}

/** Switch the local "working org" pointer (shown in uni status / whoami). */
export async function focusRegistry(registryName: string): Promise<void> {
    const registry = await requireRegistry(registryName);
    await setActiveRegistryFact(registry.name);
}

/**
 * Active org for this person: their key's registry_name, else company.infrastructure/active-registry.
 */
export async function resolveActiveRegistry(person?: string | null): Promise<string | null> {
    if (person) {
        const key = await getApiKeyByPerson(person);
        if (key?.registry_name) return key.registry_name;
    }
    // Prefer person's key first (above). Fact fallback: any registry, newest first.
    const row = await db.get<{ value: string }>(`
      SELECT value FROM facts
      WHERE namespace = 'company.infrastructure' AND key = 'active-registry'
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    return row?.value?.trim() || null;
}

/**
 * Require a working registry for fact ops. Throws if none is configured.
 */
export async function requireWorkingRegistry(person?: string | null): Promise<string> {
    const name = await resolveActiveRegistry(person);
    if (!name) {
        throw new Error('No active registry. uni init <Registry> or uni join …');
    }
    return name;
}

/**
 * uni init <Registry> — create org registry; creator becomes owner with an API key.
 */
export async function initRegistry(input: {
    name: string;
    person: string;
    description?: string;
    git_url?: string;
    /** Parent registry for lookup (read-only for this org's members). */
    parent_registry?: string | null;
    /** Preserve this secret (e.g. when mirroring an existing local key to origin). */
    api_key?: string;
    /**
     * When true (default for CLI), create the same org+owner key on upstream.
     * Origin handlers set false so mirroring does not recurse.
     */
    syncRemote?: boolean;
}): Promise<{ registry: RegistryRecord; key: ApiKeyRecord; remote?: RemoteKeyPushResult }> {
    const name = normalizeRegistryName(input.name);
    const person = input.person.trim();
    if (!person) throw new Error('--person is required');

    await assertRegistryNameAvailable(name);

    let description = input.description ?? null;
    let gitUrl = input.git_url?.trim() || null;
    if (gitUrl) {
        try {
            const meta = await getMetadataFromGitUrl(gitUrl);
            description = description || meta.description;
            gitUrl = meta.url;
        } catch {
            // keep raw url
        }
    }

    let parentName: string | null = null;
    if (input.parent_registry?.trim()) {
        const parent = await requireRegistry(input.parent_registry);
        parentName = parent.name;
        if (parent.name.toLowerCase() === name.toLowerCase()) {
            throw new Error('Registry cannot be its own parent');
        }
    }

    const now = Date.now();
    const id = randomUUID();
    await db.run(
        `INSERT INTO registries (id, name, owner_person, description, git_url, parent_registry, lookup_visibility, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'private', ?, ?)`,
        [id, name, person, description, gitUrl, parentName, now, now]
    );

    const key = await createApiKey({
        person,
        registry_name: name,
        namespaces: registryNamespaces(name),
        enabled: true,
        api_key: input.api_key
    });

    await setActiveRegistryFact(name);

    const registry = await getRegistry(name);
    if (!registry) throw new Error('Failed to create registry');

    let remote: RemoteKeyPushResult | undefined;
    if (input.syncRemote !== false) {
        remote = await mirrorRegistryToRemote({
            registry,
            key
        });
    }

    return { registry, key, remote };
}

/** Create org + matched owner key on upstream (public org create). Keys stay push-only afterward. */
async function mirrorRegistryToRemote(input: {
    registry: RegistryRecord;
    key: ApiKeyRecord;
}): Promise<RemoteKeyPushResult> {
    const remoteUrl = await getRemoteBranchUrl();
    if (!remoteUrl) {
        return { attempted: false, pushed: false, detail: 'No upstream URL configured' };
    }

    try {
        // Public endpoint: anyone may create an org. Body carries the matched owner api_key.
        // Do NOT make /v1/keys or fact writes public — only org create is open.
        const response = await fetch(`${remoteUrl}/v1/registries`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: input.registry.name,
                person: input.key.person,
                description: input.registry.description ?? undefined,
                git_url: input.registry.git_url ?? undefined,
                parent_registry: input.registry.parent_registry ?? undefined,
                api_key: input.key.api_key
            })
        });

        if (response.ok) {
            return { attempted: true, pushed: true, detail: 'Registry + owner key created on origin' };
        }

        const text = await response.text().catch(() => '');
        const detail = text.slice(0, 300) || response.statusText;

        // Person already exists on origin with a different secret — install that key locally,
        // or init with a new person name. Do not fall through to /v1/keys (misleading 401).
        if (/different key|already has a different key|already exists/i.test(detail)) {
            return {
                attempted: true,
                pushed: false,
                status: response.status,
                detail:
                    `${detail} — Origin already knows person '${input.key.person}' with another secret. ` +
                    `Use a new person (uni use name --new) then uni init, or install the origin key locally.`
            };
        }

        return {
            attempted: true,
            pushed: false,
            status: response.status,
            detail
        };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const hint =
            /fetch failed|certificate|SSL|TLS|EPROTO/i.test(msg)
                ? ' — check company.infrastructure/upstream-registry-url (prefer https://staging.unifact.ai)'
                : '';
        return {
            attempted: true,
            pushed: false,
            detail: `${msg}${hint}`
        };
    }
}

/**
 * uni join <Registry> — request membership; if you are owner, no-op approved.
 * Does not grant access until approve (unless already owner).
 */
export async function requestJoin(input: {
    registry: string;
    person: string;
    message?: string;
}): Promise<JoinRequestRecord> {
    const person = input.person.trim();
    if (!person) throw new Error('--person is required');

    const registry = await requireRegistry(input.registry);
    const registryName = registry.name;

    if (registry.owner_person === person) {
        const now = Date.now();
        const existing = await db.get<JoinRequestRow>(
            'SELECT * FROM join_requests WHERE lower(registry_name) = lower(?) AND person = ?',
            [registryName, person]
        );
        if (existing) {
            await db.run(
                `UPDATE join_requests SET status = 'approved', registry_name = ?, updated_at = ? WHERE id = ?`,
                [registryName, now, existing.id]
            );
        } else {
            await db.run(
                `INSERT INTO join_requests (id, registry_name, person, status, message, created_at, updated_at)
                 VALUES (?, ?, ?, 'approved', ?, ?, ?)`,
                [randomUUID(), registryName, person, input.message ?? 'owner', now, now]
            );
        }
        const row = await db.get<JoinRequestRow>(
            'SELECT * FROM join_requests WHERE lower(registry_name) = lower(?) AND person = ?',
            [registryName, person]
        );
        return toJoinRequest(row!);
    }

    const now = Date.now();
    const existing = await db.get<JoinRequestRow>(
        'SELECT * FROM join_requests WHERE lower(registry_name) = lower(?) AND person = ?',
        [registryName, person]
    );
    if (existing) {
        if (existing.status === 'approved') {
            return toJoinRequest(existing);
        }
        await db.run(
            `UPDATE join_requests SET status = 'pending', registry_name = ?, message = ?, updated_at = ? WHERE id = ?`,
            [registryName, input.message ?? null, now, existing.id]
        );
        const updated = await db.get<JoinRequestRow>('SELECT * FROM join_requests WHERE id = ?', [existing.id]);
        return toJoinRequest(updated!);
    }

    const id = randomUUID();
    await db.run(
        `INSERT INTO join_requests (id, registry_name, person, status, message, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
        [id, registryName, person, input.message ?? null, now, now]
    );
    const created = await db.get<JoinRequestRow>('SELECT * FROM join_requests WHERE id = ?', [id]);
    const request = toJoinRequest(created!);

    // Mirror join request on origin (membership is local + remote).
    await mirrorJoinToRemote(registryName, person, input.message).catch(() => undefined);

    return request;
}

async function mirrorJoinToRemote(
    registryName: string,
    person: string,
    message?: string
): Promise<void> {
    const remoteUrl = await getRemoteBranchUrl();
    if (!remoteUrl) return;
    const member = await getApiKeyByPerson(person);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (member?.api_key) headers['X-API-Key'] = member.api_key;
    await fetch(`${remoteUrl}/v1/registries/${encodeURIComponent(registryName)}/join`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ person, message })
    });
}

/**
 * Owner approves a join → person gets an enabled API key and request marked approved.
 * If upstream is configured, the member key is **pushed** to origin (keys are never pulled).
 * Optionally pull published **facts** into local store for the new member (--pull).
 */
export async function approveJoin(input: {
    registry: string;
    person: string;
    approved_by: string;
    pull?: boolean;
}): Promise<{
    request: JoinRequestRecord;
    key: ApiKeyRecord;
    pull?: { pulled: number; skipped: number; conflicts: number };
    remote?: RemoteKeyPushResult;
}> {
    const person = input.person.trim();
    const registry = await requireRegistry(input.registry);
    const registryName = registry.name;
    if (registry.owner_person !== input.approved_by.trim()) {
        throw new Error(`Only owner '${registry.owner_person}' can approve joins for '${registryName}'`);
    }

    const now = Date.now();
    const matches = await db.all<JoinRequestRow>(
        'SELECT * FROM join_requests WHERE lower(registry_name) = lower(?) AND person = ? ORDER BY updated_at DESC',
        [registryName, person]
    );
    let request: JoinRequestRow | undefined = matches[0];
    for (const dup of matches.slice(1)) {
        await db.run('DELETE FROM join_requests WHERE id = ?', [dup.id]);
    }
    if (!request) {
        const id = randomUUID();
        await db.run(
            `INSERT INTO join_requests (id, registry_name, person, status, message, created_at, updated_at)
             VALUES (?, ?, ?, 'approved', 'approved by owner', ?, ?)`,
            [id, registryName, person, now, now]
        );
        request = await db.get<JoinRequestRow>('SELECT * FROM join_requests WHERE id = ?', [id]);
    } else {
        await db.run(
            `UPDATE join_requests SET status = 'approved', registry_name = ?, updated_at = ? WHERE id = ?`,
            [registryName, now, request.id]
        );
        request = await db.get<JoinRequestRow>('SELECT * FROM join_requests WHERE id = ?', [request.id]);
    }
    if (!request) throw new Error('Failed to approve join request');

    const existingKey = await getApiKeyByPerson(person);
    const nsForRegistry = registryNamespaces(registryName);
    const namespaces = existingKey?.namespaces?.length
        ? [...new Set([...existingKey.namespaces, ...nsForRegistry])]
        : nsForRegistry;
    const key = await createApiKey({
        person,
        registry_name: existingKey?.registry_name ? undefined : registryName,
        namespaces,
        enabled: true
    });

    await setActiveRegistryFact(registryName);

    // Push membership key to origin (not via uni pull — keys are push-only).
    let remote: RemoteKeyPushResult | undefined;
    const ownerKey = await getApiKeyByPerson(input.approved_by.trim());
    if (ownerKey?.enabled && ownerKey.api_key) {
        remote = await pushPersonKeyToRemote({
            person: key.person,
            api_key: key.api_key,
            namespaces: key.namespaces,
            scopes: key.scopes,
            enabled: true,
            ownerApiKey: ownerKey.api_key
        });
    } else {
        remote = { attempted: false, pushed: false, detail: 'Owner has no enabled local key to auth origin push' };
    }

    let pullResult: { pulled: number; skipped: number; conflicts: number } | undefined;
    if (input.pull) {
        try {
            const result = await pullFactsFromRemote();
            pullResult = { pulled: result.pulled, skipped: result.skipped, conflicts: result.conflicts };
        } catch {
            pullResult = { pulled: 0, skipped: 0, conflicts: 0 };
        }
    }

    return { request: toJoinRequest(request!), key, pull: pullResult, remote };
}

/**
 * Owner suspends a member → membership marked suspended and their person key disabled.
 * Also pushes key-off to origin when upstream is configured (keys are push-only).
 */
export async function suspendJoin(input: {
    registry: string;
    person: string;
    suspended_by: string;
}): Promise<{ request: JoinRequestRecord; key: ApiKeyRecord; remote?: RemoteKeyPushResult }> {
    const person = input.person.trim();
    if (!person) throw new Error('--person is required');

    const registry = await requireRegistry(input.registry);
    const registryName = registry.name;
    if (registry.owner_person !== input.suspended_by.trim()) {
        throw new Error(`Only owner '${registry.owner_person}' can suspend members of '${registryName}'`);
    }
    if (registry.owner_person === person) {
        throw new Error(`Cannot suspend the registry owner '${person}'`);
    }

    const now = Date.now();
    let request = await db.get<JoinRequestRow>(
        'SELECT * FROM join_requests WHERE lower(registry_name) = lower(?) AND person = ? ORDER BY updated_at DESC',
        [registryName, person]
    );
    if (!request) {
        throw new Error(`No membership for '${person}' on '${registryName}'. They must uni join first.`);
    }

    await db.run(
        `UPDATE join_requests SET status = 'suspended', registry_name = ?, updated_at = ? WHERE id = ?`,
        [registryName, now, request.id]
    );
    await db.run(
        `DELETE FROM join_requests
         WHERE lower(registry_name) = lower(?) AND person = ? AND id != ?`,
        [registryName, person, request.id]
    );
    request = await db.get<JoinRequestRow>('SELECT * FROM join_requests WHERE id = ?', [request.id]);

    const key = await setApiKeyEnabled(person, false);

    let remote: RemoteKeyPushResult | undefined;
    const ownerKey = await getApiKeyByPerson(input.suspended_by.trim());
    if (ownerKey?.enabled && ownerKey.api_key) {
        remote = await pushPersonKeyToRemote({
            person: key.person,
            api_key: key.api_key,
            namespaces: key.namespaces,
            scopes: key.scopes,
            enabled: false,
            ownerApiKey: ownerKey.api_key
        });
    }

    return { request: toJoinRequest(request!), key, remote };
}

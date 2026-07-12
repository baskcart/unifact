import { randomUUID } from 'crypto';
import { db, type JoinRequestRow, type RegistryRow } from './db.js';
import { createApiKey, getApiKeyByPerson, setApiKeyEnabled, type ApiKeyRecord } from './keys.js';
import { getMetadataFromGitUrl } from './git-metadata.js';
import { pullFactsFromRemote } from './store.js';
import { upsertFact } from './store.js';
import { getRemoteBranchUrl, pushPersonKeyToRemote, type RemoteKeyPushResult } from './sync.js';

export interface RegistryRecord {
    id: string;
    name: string;
    owner_person: string;
    description: string | null;
    git_url: string | null;
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
    return {
        id: row.id,
        name: row.name,
        owner_person: row.owner_person,
        description: row.description,
        git_url: row.git_url,
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
    await upsertFact('company.infrastructure', 'active-registry', {
        value: registryName,
        description: 'Local active UniFact org registry name',
        fact_type: 'decision_fact',
        registry_channel: 'published',
        approval_status: 'approved',
        published_by: 'uni',
        _event: 'publish'
    });
    if (upstreamUrl) {
        await upsertFact('company.infrastructure', 'upstream-registry-url', {
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

/**
 * uni init <Registry> — create org registry; creator becomes owner with an API key.
 */
export async function initRegistry(input: {
    name: string;
    person: string;
    description?: string;
    git_url?: string;
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

    const existing = await getRegistry(name);
    if (existing) {
        throw new Error(`Registry '${name}' already exists (owner: ${existing.owner_person})`);
    }

    const now = Date.now();
    const id = randomUUID();
    await db.run(
        `INSERT INTO registries (id, name, owner_person, description, git_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, name, person, description, gitUrl, now, now]
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
        const response = await fetch(`${remoteUrl}/v1/registries`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: input.registry.name,
                person: input.key.person,
                description: input.registry.description ?? undefined,
                git_url: input.registry.git_url ?? undefined,
                api_key: input.key.api_key
            })
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            // Org may already exist on origin — still try to upsert the owner key.
            if (response.status !== 409 && response.status !== 400) {
                return {
                    attempted: true,
                    pushed: false,
                    status: response.status,
                    detail: text.slice(0, 200) || response.statusText
                };
            }
        }

        // Ensure owner key/namespaces are on origin (same secret).
        const keyPush = await pushPersonKeyToRemote({
            person: input.key.person,
            api_key: input.key.api_key,
            namespaces: input.key.namespaces,
            scopes: input.key.scopes,
            enabled: true,
            ownerApiKey: input.key.api_key
        });

        if (keyPush.pushed) return keyPush;

        // After public registry create, owner key should auth; if key push failed, report registry create OK.
        if (response.ok) {
            return { attempted: true, pushed: true, detail: 'Registry created on origin' };
        }
        return keyPush;
    } catch (error) {
        return {
            attempted: true,
            pushed: false,
            detail: error instanceof Error ? error.message : String(error)
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

    const key = await createApiKey({
        person,
        registry_name: registryName,
        namespaces: registryNamespaces(registryName),
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

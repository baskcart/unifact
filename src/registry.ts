import { randomUUID } from 'crypto';
import { db, type JoinRequestRow, type RegistryRow } from './db.js';
import { createApiKey, type ApiKeyRecord } from './keys.js';
import { getMetadataFromGitUrl } from './git-metadata.js';
import { pullFactsFromRemote } from './store.js';
import { upsertFact } from './store.js';

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
    status: 'pending' | 'approved' | 'rejected';
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
    const status = row.status === 'approved' || row.status === 'rejected' ? row.status : 'pending';
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

export async function listJoinRequests(registryName?: string): Promise<JoinRequestRecord[]> {
    const rows = registryName
        ? await db.all<JoinRequestRow>(
            'SELECT * FROM join_requests WHERE registry_name = ? ORDER BY created_at ASC',
            [normalizeRegistryName(registryName)]
        )
        : await db.all<JoinRequestRow>('SELECT * FROM join_requests ORDER BY created_at ASC');
    return rows.map(toJoinRequest);
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
}): Promise<{ registry: RegistryRecord; key: ApiKeyRecord }> {
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
        enabled: true
    });

    await setActiveRegistryFact(name);

    const registry = await getRegistry(name);
    if (!registry) throw new Error('Failed to create registry');
    return { registry, key };
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
    const registryName = normalizeRegistryName(input.registry);
    const person = input.person.trim();
    if (!person) throw new Error('--person is required');

    const registry = await getRegistry(registryName);
    if (!registry) {
        throw new Error(`Registry '${registryName}' not found. Ask the owner to uni init ${registryName} first.`);
    }

    if (registry.owner_person === person) {
        const now = Date.now();
        const existing = await db.get<JoinRequestRow>(
            'SELECT * FROM join_requests WHERE registry_name = ? AND person = ?',
            [registryName, person]
        );
        if (existing) {
            await db.run(
                `UPDATE join_requests SET status = 'approved', updated_at = ? WHERE id = ?`,
                [now, existing.id]
            );
        } else {
            await db.run(
                `INSERT INTO join_requests (id, registry_name, person, status, message, created_at, updated_at)
                 VALUES (?, ?, ?, 'approved', ?, ?, ?)`,
                [randomUUID(), registryName, person, input.message ?? 'owner', now, now]
            );
        }
        const row = await db.get<JoinRequestRow>(
            'SELECT * FROM join_requests WHERE registry_name = ? AND person = ?',
            [registryName, person]
        );
        return toJoinRequest(row!);
    }

    const now = Date.now();
    const existing = await db.get<JoinRequestRow>(
        'SELECT * FROM join_requests WHERE registry_name = ? AND person = ?',
        [registryName, person]
    );
    if (existing) {
        if (existing.status === 'approved') {
            return toJoinRequest(existing);
        }
        await db.run(
            `UPDATE join_requests SET status = 'pending', message = ?, updated_at = ? WHERE id = ?`,
            [input.message ?? null, now, existing.id]
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
    return toJoinRequest(created!);
}

/**
 * Owner approves a join → person gets an enabled API key and request marked approved.
 * Optionally pull published facts into local store for the new member.
 */
export async function approveJoin(input: {
    registry: string;
    person: string;
    approved_by: string;
    pull?: boolean;
}): Promise<{ request: JoinRequestRecord; key: ApiKeyRecord; pull?: { pulled: number; skipped: number; conflicts: number } }> {
    const registryName = normalizeRegistryName(input.registry);
    const person = input.person.trim();
    const registry = await getRegistry(registryName);
    if (!registry) throw new Error(`Registry '${registryName}' not found`);
    if (registry.owner_person !== input.approved_by.trim()) {
        throw new Error(`Only owner '${registry.owner_person}' can approve joins for '${registryName}'`);
    }

    const now = Date.now();
    let request = await db.get<JoinRequestRow>(
        'SELECT * FROM join_requests WHERE registry_name = ? AND person = ?',
        [registryName, person]
    );
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
            `UPDATE join_requests SET status = 'approved', updated_at = ? WHERE id = ?`,
            [now, request.id]
        );
        request = await db.get<JoinRequestRow>('SELECT * FROM join_requests WHERE id = ?', [request.id]);
    }

    const key = await createApiKey({
        person,
        registry_name: registryName,
        namespaces: registryNamespaces(registryName),
        enabled: true
    });

    await setActiveRegistryFact(registryName);

    let pullResult: { pulled: number; skipped: number; conflicts: number } | undefined;
    if (input.pull) {
        try {
            const result = await pullFactsFromRemote();
            pullResult = { pulled: result.pulled, skipped: result.skipped, conflicts: result.conflicts };
        } catch {
            pullResult = { pulled: 0, skipped: 0, conflicts: 0 };
        }
    }

    return { request: toJoinRequest(request!), key, pull: pullResult };
}

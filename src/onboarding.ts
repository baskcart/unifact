import { createApiKey, getActiveLocalApiKey, getApiKeyByPerson, usePerson } from './keys.js';
import { getRegistry, initRegistry, listRegistriesForPerson } from './registry.js';
import { getSyncStatus, upsertFact } from './store.js';
import { getSyncConfig } from './sync.js';

const DEFAULT_UPSTREAM = 'https://staging.unifact.ai';

export function normalizeUpstreamUrl(input?: string): string {
    const url = new URL(input?.trim() || DEFAULT_UPSTREAM);
    if (url.username || url.password || url.search || url.hash) {
        throw new Error('Upstream URL must not include credentials, query parameters, or fragments');
    }
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
        throw new Error('Hosted UniFact registries must use HTTPS');
    }
    if (url.pathname !== '/' && url.pathname !== '') {
        throw new Error('Upstream URL must be an origin, for example https://staging.unifact.ai');
    }
    return url.origin;
}

function normalizePerson(person: string): string {
    const value = person.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_.@-]{0,79}$/.test(value)) {
        throw new Error('Person must be 1–80 characters using letters, numbers, . _ @ or -');
    }
    return value;
}

export async function getRegistryOnboardingStatus() {
    const active = await getActiveLocalApiKey();
    const memberships = active?.person ? await listRegistriesForPerson(active.person) : [];
    const sync = await getSyncStatus();
    return {
        active_person: active?.person ?? null,
        active_registry: active?.registry_name ?? null,
        memberships: memberships.map((membership) => ({
            registry: membership.registry.name,
            role: membership.role,
            status: membership.status
        })),
        upstream: sync.upstreamUrl,
        sync_enabled: sync.enabled,
        ready_to_pull: Boolean(active?.registry_name && sync.upstreamUrl && sync.enabled),
        secret_exposed: false
    };
}

export async function requestRemoteRegistryJoin(input: {
    upstream_url?: string;
    registry: string;
    person: string;
    message?: string;
}) {
    const upstream = normalizeUpstreamUrl(input.upstream_url);
    const person = normalizePerson(input.person);
    const registryName = input.registry.trim();
    if (!registryName) throw new Error('Registry name is required');

    let localRegistry = await getRegistry(registryName);
    let key = await getApiKeyByPerson(person);
    if (!localRegistry) {
        const initialized = await initRegistry({
            name: registryName,
            person,
            description: 'Local mirror created during hosted registry onboarding',
            syncRemote: false
        });
        localRegistry = initialized.registry;
        key = initialized.key;
    } else if (!key) {
        key = await createApiKey({
            person,
            registry_name: localRegistry.name,
            namespaces: ['*'],
            scopes: ['read', 'write'],
            enabled: true
        });
    } else if (key.registry_name?.toLowerCase() !== localRegistry.name.toLowerCase()) {
        key = await createApiKey({
            person,
            registry_name: localRegistry.name,
            namespaces: key.namespaces,
            scopes: key.scopes,
            enabled: true
        });
    }

    await upsertFact(localRegistry.name, 'company.infrastructure', 'upstream-registry-url', {
        value: upstream,
        description: 'Hosted UniFact registry used for pull and push',
        fact_type: 'decision_fact',
        registry_channel: 'published',
        approval_status: 'approved',
        published_by: 'unifact-onboarding',
        _event: 'publish'
    });
    await usePerson(person);

    const response = await fetch(`${upstream}/v1/registries/${encodeURIComponent(localRegistry.name)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            person,
            message: input.message?.slice(0, 500),
            candidate_api_key: key.api_key
        })
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
        const detail = typeof body.error === 'string' ? body.error : response.statusText;
        if (response.status === 401 || response.status === 403) {
            throw new Error(
                `Hosted registry rejected self-service join (${response.status}). ` +
                'The hosted UniFact service must be upgraded to the MCP onboarding release. ' + detail
            );
        }
        throw new Error(`Join request failed (${response.status}): ${detail}`);
    }

    const request = (body.request ?? {}) as Record<string, unknown>;
    return {
        registry: localRegistry.name,
        person,
        upstream,
        status: request.status ?? 'pending',
        request_id: request.id ?? null,
        local_device_key_registered: true,
        secret_exposed: false,
        next_step: request.status === 'approved'
            ? 'Ask UniFact to sync_pull.'
            : `An owner of '${localRegistry.name}' must approve '${person}'. After approval, ask UniFact to sync_pull.`
    };
}

async function getRemoteOwnerContext(upstreamUrl?: string) {
    const active = await getActiveLocalApiKey();
    if (!active?.api_key) throw new Error('No active UniFact owner identity is configured on this device');
    const config = await getSyncConfig();
    const upstream = normalizeUpstreamUrl(upstreamUrl || config.upstreamUrl || undefined);
    return { active, upstream };
}

export async function listRemoteRegistryJoinRequests(input: {
    registry: string;
    upstream_url?: string;
}) {
    const { active, upstream } = await getRemoteOwnerContext(input.upstream_url);
    const response = await fetch(
        `${upstream}/v1/registries/${encodeURIComponent(input.registry.trim())}/requests`,
        { headers: { 'X-API-Key': active.api_key } }
    );
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
        throw new Error(`Could not list hosted join requests (${response.status}): ${String(body.error || response.statusText)}`);
    }
    return {
        registry: input.registry.trim(),
        upstream,
        requests: Array.isArray(body.requests) ? body.requests : [],
        count: typeof body.count === 'number' ? body.count : 0,
        secret_exposed: false
    };
}

export async function approveRemoteRegistryJoin(input: {
    registry: string;
    person: string;
    upstream_url?: string;
}) {
    const { active, upstream } = await getRemoteOwnerContext(input.upstream_url);
    const response = await fetch(
        `${upstream}/v1/registries/${encodeURIComponent(input.registry.trim())}/approve`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': active.api_key
            },
            body: JSON.stringify({ person: normalizePerson(input.person) })
        }
    );
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
        throw new Error(`Could not approve hosted join request (${response.status}): ${String(body.error || response.statusText)}`);
    }
    const request = (body.request ?? {}) as Record<string, unknown>;
    return {
        registry: input.registry.trim(),
        person: normalizePerson(input.person),
        upstream,
        status: request.status ?? 'approved',
        approved_by: active.person,
        device_key_activated: true,
        secret_exposed: false,
        next_step: `Ask '${normalizePerson(input.person)}' to run sync_pull from their UniFact agent.`
    };
}

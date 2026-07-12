import 'dotenv/config';
import { db } from './db.js';
import { getActiveLocalApiKey } from './keys.js';

export interface SyncConfig {
    upstreamUrl: string | null;
    remoteUrl: string | null;
    apiKey: string | null;
    role: string;
    branch: string;
    enabled: boolean;
    source: 'env' | 'fact' | 'none';
    person: string | null;
}

async function getConfigFact(key: string): Promise<string | null> {
    const active = await getActiveLocalApiKey();
    const registryName = active?.registry_name?.trim() || null;

    if (registryName) {
        const scoped = await db.get<{ value: string }>(`
          SELECT value
          FROM facts
          WHERE namespace = 'company.infrastructure' AND key = ? AND registry_name = ?
        `, [key, registryName]);
        if (scoped?.value != null) return scoped.value;
    }

    const fallback = await db.get<{ value: string }>(`
      SELECT value
      FROM facts
      WHERE namespace = 'company.infrastructure' AND key = ?
      LIMIT 1
    `, [key]);

    return fallback?.value ?? null;
}

export async function getSyncConfig(): Promise<SyncConfig> {
    const urlFact = (await getConfigFact('upstream-registry-url')) ?? (await getConfigFact('remote-registry-url'));
    const roleFact = (await getConfigFact('upstream-registry-role')) ?? (await getConfigFact('remote-registry-branch'));

    const upstreamUrl = urlFact || process.env.UNIFACT_UPSTREAM_REGISTRY_URL || null;
    const active = await getActiveLocalApiKey();
    const apiKey = active?.api_key ?? null;
    const role = roleFact || process.env.UNIFACT_UPSTREAM_REGISTRY_ROLE || 'staging';
    const source = urlFact ? 'fact' : upstreamUrl ? 'env' : 'none';

    return {
        upstreamUrl,
        remoteUrl: upstreamUrl,
        apiKey,
        role,
        branch: role,
        enabled: Boolean(upstreamUrl && apiKey),
        source,
        person: active?.person ?? null
    };
}

export async function getRemoteBranchUrl(_branch?: string): Promise<string | null> {
    const config = await getSyncConfig();
    if (!config.upstreamUrl) return null;

    return config.upstreamUrl.replace(/\/$/, '');
}

export interface RemoteKeyPushResult {
    attempted: boolean;
    pushed: boolean;
    status?: number;
    detail?: string;
}

/**
 * Push a person API key to origin (approve/suspend). Keys are push-only — never pulled.
 * Authenticated as the owner (or other privileged) key.
 */
export async function pushPersonKeyToRemote(input: {
    person: string;
    api_key: string;
    namespaces: string[];
    scopes: Array<'read' | 'write'>;
    enabled: boolean;
    ownerApiKey: string;
}): Promise<RemoteKeyPushResult> {
    const remoteUrl = await getRemoteBranchUrl();
    if (!remoteUrl) {
        return { attempted: false, pushed: false, detail: 'No upstream URL configured' };
    }

    try {
        const response = await fetch(`${remoteUrl}/v1/keys`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': input.ownerApiKey
            },
            body: JSON.stringify({
                person: input.person,
                api_key: input.api_key,
                namespaces: input.namespaces,
                scopes: input.scopes,
                enabled: input.enabled
            })
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            return {
                attempted: true,
                pushed: false,
                status: response.status,
                detail: text.slice(0, 200) || response.statusText
            };
        }

        // Ensure on/off matches (older hosts may ignore enabled on upsert).
        const toggle = input.enabled ? 'on' : 'off';
        await fetch(`${remoteUrl}/v1/keys/${encodeURIComponent(input.person)}/${toggle}`, {
            method: 'POST',
            headers: { 'X-API-Key': input.ownerApiKey }
        }).catch(() => undefined);

        return { attempted: true, pushed: true };
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const hint =
            /fetch failed|certificate|SSL|TLS|EPROTO/i.test(msg)
                ? ' — https to staging fails with self-signed cert; use http://staging.unifact.ai in upstream-registry-url'
                : '';
        return {
            attempted: true,
            pushed: false,
            detail: `${msg}${hint}`
        };
    }
}

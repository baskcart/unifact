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
    const row = await db.get<{ value: string }>(`
      SELECT value
      FROM facts
      WHERE namespace = 'company.infrastructure' AND key = ?
    `, [key]);

    return row?.value ?? null;
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

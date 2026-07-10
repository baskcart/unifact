import 'dotenv/config';
import { db } from './db.js';

export interface SyncConfig {
    upstreamUrl: string | null;
    remoteUrl: string | null;
    apiKey: string | null;
    role: string;
    branch: string;
    enabled: boolean;
    source: 'env' | 'fact' | 'none';
}

function getConfigFact(key: string): string | null {
    const row = db.prepare(`
      SELECT value
      FROM facts
      WHERE namespace = 'company.infrastructure' AND key = ?
    `).get(key) as { value: string } | undefined;

    return row?.value ?? null;
}

export function getSyncConfig(): SyncConfig {
    const urlFact = getConfigFact('upstream-registry-url') ?? getConfigFact('remote-registry-url');
    const roleFact = getConfigFact('upstream-registry-role') ?? getConfigFact('remote-registry-branch');

    const upstreamUrl = urlFact || process.env.UNIFACT_UPSTREAM_REGISTRY_URL || process.env.UNIFACT_REMOTE_URL || null;
    const apiKey = process.env.UNIFACT_API_KEY || process.env.UNIFACT_MASTER_KEY || null;
    const role = roleFact || process.env.UNIFACT_UPSTREAM_REGISTRY_ROLE || process.env.UNIFACT_BRANCH || 'staging';
    const source = urlFact ? 'fact' : upstreamUrl ? 'env' : 'none';

    return {
        upstreamUrl,
        remoteUrl: upstreamUrl,
        apiKey,
        role,
        branch: role,
        enabled: Boolean(upstreamUrl && apiKey),
        source
    };
}

export function getRemoteBranchUrl(branch?: string): string | null {
    const config = getSyncConfig();
    if (!config.upstreamUrl) return null;

    return config.upstreamUrl.replace(/\/$/, '');
}

/**
 * Example: load non-secret Auth.js / app config from UniFact facts.
 * Copy into your app (e.g. dahg-ai). Do not treat this as an Auth.js upstream plugin.
 *
 * Bootstrap env only:
 *   UNIFACT_URL=https://staging.unifact.ai
 *   UNIFACT_API_KEY=uf_…          # read access to company.infrastructure
 *   AUTH_GITHUB_SECRET=…          # secret — never a fact
 *   AUTH_SECRET=…                 # secret — never a fact
 *
 * Facts (published):
 *   company.infrastructure/auth-url
 *   company.infrastructure/auth-github-id
 */
export type UnifactAuthConfig = {
    authUrl: string;
    githubId: string;
    githubSecret: string;
    authSecret: string;
    source: { authUrl: 'fact' | 'env'; githubId: 'fact' | 'env' };
};

type FactRow = { key: string; value: string; registry_channel?: string };

async function listInfrastructureFacts(baseUrl: string, apiKey: string): Promise<FactRow[]> {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/facts/company.infrastructure`, {
        headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
        cache: 'no-store'
    });
    if (!res.ok) {
        throw new Error(`UniFact facts failed (${res.status})`);
    }
    const data = (await res.json()) as { facts?: FactRow[] };
    return Array.isArray(data.facts) ? data.facts : [];
}

function pick(facts: FactRow[], key: string): string | undefined {
    const row = facts.find(
        (f) => f.key === key && (f.registry_channel === 'published' || !f.registry_channel)
    );
    return row?.value?.trim() || undefined;
}

/**
 * Resolve Auth config: facts win for non-secrets when present; secrets always from env.
 */
export async function loadAuthConfigFromUnifact(env: NodeJS.ProcessEnv = process.env): Promise<UnifactAuthConfig> {
    const baseUrl = env.UNIFACT_URL?.trim();
    const apiKey = (env.UNIFACT_API_KEY || env.UNIFACT_MASTER_KEY || '').trim();
    const githubSecret = env.AUTH_GITHUB_SECRET?.trim();
    const authSecret = env.AUTH_SECRET?.trim();

    if (!githubSecret) throw new Error('AUTH_GITHUB_SECRET is required (env only)');
    if (!authSecret) throw new Error('AUTH_SECRET is required (env only)');

    let authUrl = env.AUTH_URL?.trim() || '';
    let githubId = env.AUTH_GITHUB_ID?.trim() || '';
    let authUrlSource: 'fact' | 'env' = 'env';
    let githubIdSource: 'fact' | 'env' = 'env';

    if (baseUrl && apiKey) {
        try {
            const facts = await listInfrastructureFacts(baseUrl, apiKey);
            const factUrl = pick(facts, 'auth-url');
            const factId = pick(facts, 'auth-github-id');
            if (factUrl) {
                authUrl = factUrl;
                authUrlSource = 'fact';
            }
            if (factId) {
                githubId = factId;
                githubIdSource = 'fact';
            }
        } catch {
            // Fall back to env if registry unreachable at boot.
        }
    }

    if (!authUrl) throw new Error('auth-url fact or AUTH_URL env is required');
    if (!githubId) throw new Error('auth-github-id fact or AUTH_GITHUB_ID env is required');

    return {
        authUrl,
        githubId,
        githubSecret,
        authSecret,
        source: { authUrl: authUrlSource, githubId: githubIdSource }
    };
}

/**
 * Auth.js v5 sketch (your app's auth.ts):
 *
 *   import NextAuth from 'next-auth'
 *   import GitHub from 'next-auth/providers/github'
 *   import { loadAuthConfigFromUnifact } from './unifactAuthConfig'
 *
 *   const cfg = await loadAuthConfigFromUnifact()
 *   export const { handlers, auth, signIn, signOut } = NextAuth({
 *     providers: [GitHub({ clientId: cfg.githubId, clientSecret: cfg.githubSecret })],
 *     // AUTH_URL / trustHost: use cfg.authUrl via AUTH_URL in env or Auth.js conventions
 *   })
 *
 * Prefer caching cfg for the process lifetime; do not call on every Edge middleware hit.
 */

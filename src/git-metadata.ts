/**
 * Resolve org/repo metadata from a Git hosting URL.
 * Uses HTTP(S) / public APIs only — never clones with git, never reads UniFact registry.
 */

export interface GitUrlMetadata {
    source: 'github' | 'gitlab' | 'bitbucket' | 'url';
    url: string;
    org: string | null;
    repo: string | null;
    name: string | null;
    description: string | null;
    homepage: string | null;
    default_branch: string | null;
    private: boolean | null;
}

function normalizeGitUrl(input: string): URL {
    let raw = input.trim();
    if (raw.startsWith('git@')) {
        // git@github.com:org/repo.git → https://github.com/org/repo
        raw = raw.replace(/^git@([^:]+):/, 'https://$1/');
    }
    if (!/^https?:\/\//i.test(raw)) {
        raw = `https://${raw}`;
    }
    const url = new URL(raw);
    url.pathname = url.pathname.replace(/\.git$/i, '').replace(/\/$/, '');
    return url;
}

function pathParts(url: URL): string[] {
    return url.pathname.split('/').filter(Boolean);
}

export function parseGitHostingUrl(input: string): Pick<GitUrlMetadata, 'source' | 'url' | 'org' | 'repo'> {
    const url = normalizeGitUrl(input);
    const host = url.hostname.toLowerCase();
    const parts = pathParts(url);

    if (host === 'github.com' || host === 'www.github.com') {
        return {
            source: 'github',
            url: `https://github.com/${parts[0]}/${parts[1]}`,
            org: parts[0] ?? null,
            repo: parts[1] ?? null
        };
    }

    if (host === 'gitlab.com' || host.endsWith('.gitlab.com')) {
        return {
            source: 'gitlab',
            url: `${url.origin}/${parts.join('/')}`,
            org: parts.length >= 2 ? parts.slice(0, -1).join('/') : (parts[0] ?? null),
            repo: parts.length >= 1 ? parts[parts.length - 1] : null
        };
    }

    if (host === 'bitbucket.org') {
        return {
            source: 'bitbucket',
            url: `https://bitbucket.org/${parts[0]}/${parts[1]}`,
            org: parts[0] ?? null,
            repo: parts[1] ?? null
        };
    }

    return {
        source: 'url',
        url: url.toString(),
        org: parts[0] ?? null,
        repo: parts[1] ?? null
    };
}

async function fetchGithubMetadata(org: string, repo: string): Promise<Partial<GitUrlMetadata>> {
    const response = await fetch(`https://api.github.com/repos/${org}/${repo}`, {
        headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'unifact-metadata'
        }
    });
    if (!response.ok) {
        throw new Error(`GitHub metadata lookup failed (${response.status})`);
    }
    const data = (await response.json()) as {
        name?: string;
        full_name?: string;
        description?: string | null;
        homepage?: string | null;
        default_branch?: string;
        private?: boolean;
        html_url?: string;
        owner?: { login?: string };
    };
    return {
        name: data.name ?? repo,
        description: data.description ?? null,
        homepage: data.homepage || data.html_url || null,
        default_branch: data.default_branch ?? null,
        private: data.private ?? null,
        org: data.owner?.login ?? org,
        repo: data.name ?? repo,
        url: data.html_url ?? `https://github.com/${org}/${repo}`
    };
}

async function fetchGitlabMetadata(pathWithNamespace: string): Promise<Partial<GitUrlMetadata>> {
    const encoded = encodeURIComponent(pathWithNamespace);
    const response = await fetch(`https://gitlab.com/api/v4/projects/${encoded}`, {
        headers: { 'User-Agent': 'unifact-metadata' }
    });
    if (!response.ok) {
        throw new Error(`GitLab metadata lookup failed (${response.status})`);
    }
    const data = (await response.json()) as {
        name?: string;
        description?: string | null;
        web_url?: string;
        default_branch?: string;
        visibility?: string;
        namespace?: { full_path?: string; path?: string };
        path?: string;
    };
    return {
        name: data.name ?? null,
        description: data.description ?? null,
        homepage: data.web_url ?? null,
        default_branch: data.default_branch ?? null,
        private: data.visibility ? data.visibility !== 'public' : null,
        org: data.namespace?.full_path ?? data.namespace?.path ?? null,
        repo: data.path ?? null,
        ...(data.web_url ? { url: data.web_url } : {})
    };
}

/**
 * Parse a git hosting URL and enrich with public API metadata when available.
 */
export async function getMetadataFromGitUrl(input: string): Promise<GitUrlMetadata> {
    const parsed = parseGitHostingUrl(input);
    const base: GitUrlMetadata = {
        source: parsed.source,
        url: parsed.url,
        org: parsed.org,
        repo: parsed.repo,
        name: parsed.repo,
        description: null,
        homepage: parsed.url,
        default_branch: null,
        private: null
    };

    try {
        if (parsed.source === 'github' && parsed.org && parsed.repo) {
            return { ...base, ...(await fetchGithubMetadata(parsed.org, parsed.repo)), source: 'github' };
        }
        if (parsed.source === 'gitlab' && parsed.org && parsed.repo) {
            const path = `${parsed.org}/${parsed.repo}`.replace(/^\/+|\/+$/g, '');
            return { ...base, ...(await fetchGitlabMetadata(path)), source: 'gitlab' };
        }
    } catch (err) {
        // Fall back to URL-derived fields when API is private/rate-limited/unavailable.
        base.description = err instanceof Error ? `(metadata unavailable: ${err.message})` : null;
    }

    return base;
}

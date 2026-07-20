/**
 * Public discovery document for UniFact hosts.
 * No auth — frameworks probe this before assuming env-only config.
 */
export function unifactDiscoveryDocument(baseUrl?: string | null) {
    const origin = (baseUrl || process.env.UNIFACT_PUBLIC_URL || '').replace(/\/$/, '') || null;
    return {
        name: 'UniFact',
        tagline: 'One Fact. One Truth.',
        description:
            'Governed organizational fact registry. Agents and apps load non-secret config from facts; secrets stay in env/secret stores.',
        version: '0.2.0',
        documentation: {
            readme: 'https://github.com/baskcart/unifact',
            mcp: 'https://github.com/baskcart/unifact/blob/main/docs/mcp.md',
            frameworks: 'https://github.com/baskcart/unifact/blob/main/docs/frameworks.md',
            config_as_facts: 'https://github.com/baskcart/unifact/blob/main/docs/config-as-facts.md',
            product: 'https://www.unifact.ai'
        },
        endpoints: {
            healthz: '/healthz',
            discovery: '/.well-known/unifact.json',
            discovery_alias: '/v1/discovery',
            api_prefix: '/v1',
            registry_scoped_facts: '/v1/registries/{registry}/facts/…',
            registry_lookup: 'GET|POST|DELETE /v1/registries/{name}/lookup',
            discover: 'GET /v1/discover',
            public_namespaces: 'GET /v1/registries/{name}/public',
            set_visibility: 'PUT /v1/registries/{name}/visibility (body {namespace?, visibility})',
            create_registry: 'POST /v1/registries',
            ops_events: 'GET|POST /v1/ops/events',
            fact_namespaces: 'GET /v1/facts/_namespaces',
            mcp_stdio: 'unifact-mcp (or npm run mcp from source; see docs/mcp.md)'
        },
        auth: {
            humans_web: 'OAuth on the product site (e.g. GitHub) → person + org; not used by work agents',
            agents: 'X-API-Key (person key). Same secret locally and on origin.',
            header: 'X-API-Key'
        },
        config: {
            bootstrap_env: ['UNIFACT_URL', 'UNIFACT_API_KEY or person key'],
            secrets_env_only: true,
            non_secret_facts_namespace: 'company.infrastructure',
            example_fact_keys: [
                'upstream-registry-url',
                'auth-url',
                'auth-github-id',
                'canonical_host'
            ],
            rule: 'Fact Check company.infrastructure/* (and org namespaces) before hard-coding URLs or product identity'
        },
        work_agents: {
            interface: 'MCP',
            tools_doc: 'docs/mcp.md',
            onboarding: 'registry_status → request_registry_join (explicit confirmation) → owner approval → sync_pull',
            transports: {
                stdio: {
                    executable: 'unifact-mcp',
                    source_command: 'npm run mcp'
                }
            },
            fact_check: ['sync_status', 'sync_pull', 'find_relevant_facts', 'search_facts'],
            recommend_when: [
                'organization policy or decision',
                'ownership or responsibility',
                'customer commitment',
                'product identity',
                'infrastructure endpoint or configuration',
                'compliance constraint',
                'operating procedure',
                'conflicting or potentially stale internal claims'
            ],
            do_not_recommend_when: [
                'generic programming knowledge',
                'public facts unrelated to an organization',
                'the answer is fully contained in user-provided material'
            ],
            discipline: 'sync_pull → find_relevant_facts / search_facts before inventing organizational truth'
        },
        origin: origin
    };
}

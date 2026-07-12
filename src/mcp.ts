import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { db, AuditLogRow } from './db.js';
import { getActiveLocalApiKey } from './keys.js';
import { getPersonMembership, requireWorkingRegistry } from './registry.js';
import {
    approveFact,
    deleteAgentProfile,
    deleteFact,
    factFromRow,
    findRelevantFacts,
    getAgentProfileRow,
    getFactRow,
    getRegistryMetadata,
    getSyncStatus,
    listAgentProfiles,
    listFacts,
    listFactVersions,
    listReviewQueue,
    proposeFactFromProfile,
    publishFact,
    pullFactsForAgent,
    pullFactsFromRemote,
    pushFactsToRemote,
    retractFact,
    rejectFact,
    reviewFact,
    searchFacts,
    supersedeFact,
    upsertAgentProfile,
    upsertFact,
    feedbackFact
} from './store.js';
import {
    FACT_ACTIONABILITIES,
    FACT_APPROVAL_STATUSES,
    FACT_DERIVATIONS,
    FACT_PRIORITIES,
    FACT_REGISTRY_CHANNELS,
    FACT_STATUSES,
    FACT_TYPES
} from './model.js';

type JsonObject = Record<string, unknown>;

const server = new McpServer({
    name: 'unifact',
    version: '0.2.0'
});

const optionalRegistryField = {
    registry: z.string().min(1).optional().describe('Org registry name; must match membership if provided')
};

async function resolveToolRegistry(requested?: string | null): Promise<string> {
    const active = await getActiveLocalApiKey();
    if (requested?.trim()) {
        const name = requested.trim();
        if (active?.person) {
            const membership = await getPersonMembership(active.person, name);
            if (!membership) {
                throw new Error(`Not a member of registry '${name}'`);
            }
            return membership.registry.name;
        }
        const fallback = active?.registry_name?.trim() || (await requireWorkingRegistry(null));
        if (name.toLowerCase() !== fallback.toLowerCase()) {
            throw new Error(`registry '${name}' is not available`);
        }
        return fallback;
    }
    if (active?.registry_name?.trim()) return active.registry_name.trim();
    return requireWorkingRegistry(active?.person ?? null);
}

const factMetadataSchema = {
    description: z.string().nullable().optional().describe('Optional fact description'),
    fact_type: z.enum(FACT_TYPES).optional().describe('Fact category'),
    subject: z.string().nullable().optional().describe('Entity, workflow, customer, repo, or concept this fact is about'),
    scope: z.string().nullable().optional().describe('Applicability scope, for example customer, support, ops, repo, finance'),
    status: z.enum(FACT_STATUSES).optional().describe('Fact lifecycle status'),
    derivation: z.enum(FACT_DERIVATIONS).optional().describe('Whether the fact is asserted, observed, or derived'),
    confidence: z.number().min(0).max(1).nullable().optional().describe('Confidence from 0 to 1'),
    source: z.string().nullable().optional().describe('Source system, document, ticket, report, conversation, or agent'),
    evidence: z.any().optional().describe('Evidence payload or links backing the fact'),
    valid_from: z.union([z.number(), z.string()]).nullable().optional().describe('When the fact starts applying'),
    valid_until: z.union([z.number(), z.string()]).nullable().optional().describe('When the fact stops applying'),
    observed_at: z.union([z.number(), z.string()]).nullable().optional().describe('When the fact was observed'),
    time_period: z.string().nullable().optional().describe('Time period for derived or operational facts'),
    audience: z.array(z.string()).optional().describe('Agent roles or audiences this fact is relevant to'),
    relevance_tags: z.array(z.string()).optional().describe('Intent or workflow tags for relevance matching'),
    actionability: z.enum(FACT_ACTIONABILITIES).optional().describe('Whether this fact is informational, blocking, actionable, etc.'),
    owner: z.string().nullable().optional().describe('Role, team, profile, or human expected to act'),
    priority: z.enum(FACT_PRIORITIES).optional().describe('Operational priority'),
    related_facts: z.array(z.string()).optional().describe('Related fact paths like namespace/key'),
    created_by: z.string().nullable().optional().describe('Agent profile, human, or system that created the fact'),
    approved_by: z.string().nullable().optional().describe('Approver for trusted facts'),
    approval_status: z.enum(FACT_APPROVAL_STATUSES).optional().describe('Review status'),
        registry_channel: z.enum(FACT_REGISTRY_CHANNELS).optional().describe('Working, proposed, review, feedback, published, superseded, or retracted channel'),
    published_at: z.union([z.number(), z.string()]).nullable().optional().describe('When this fact was published'),
    published_by: z.string().nullable().optional().describe('Publisher for published facts'),
    change_reason: z.string().nullable().optional().describe('Reason for this fact version or lifecycle transition'),
    supersedes: z.string().nullable().optional().describe('Fact path this fact supersedes'),
    superseded_by: z.string().nullable().optional().describe('Fact path that superseded this fact')
};

const agentProfileSchema = {
    name: z.string().min(1).optional().describe('Human-readable profile name'),
    description: z.string().nullable().optional().describe('What this agent profile is for'),
    role: z.string().min(1).optional().describe('Stable role identifier'),
    allowed_fact_types: z.array(z.string()).optional().describe('Fact types this profile can read/use by default'),
    writable_fact_types: z.array(z.string()).optional().describe('Fact types this profile can create or propose'),
    relevant_scopes: z.array(z.string()).optional().describe('Scopes this profile usually cares about'),
    relevant_subjects: z.array(z.string()).optional().describe('Subjects this profile usually cares about'),
    intents: z.array(z.string()).optional().describe('Work intents this profile supports'),
    audience_tags: z.array(z.string()).optional().describe('Audience tags used to match facts to this profile'),
    can_propose_facts: z.boolean().optional().describe('Whether this profile can propose facts'),
    can_approve_facts: z.boolean().optional().describe('Whether this profile can approve facts immediately'),
    allowed_actions: z.array(z.string()).optional().describe('Actions this profile may perform'),
    requires_human_approval_for: z.array(z.string()).optional().describe('Actionability classes or actions needing human approval')
};

function toolResult(data: unknown) {
    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(data, null, 2)
            }
        ],
        structuredContent: data as JsonObject
    };
}

function errorResult(message: string) {
    return {
        isError: true,
        content: [
            {
                type: 'text' as const,
                text: message
            }
        ]
    };
}

server.registerTool('list_namespaces', {
    description: 'List namespaces in the UniFact store with fact counts',
    inputSchema: {
        ...optionalRegistryField
    }
}, async ({ registry: registryArg }) => {
    try {
        const registry = await resolveToolRegistry(registryArg);
        const rows = await db.all<{ namespace: string; count: number }>(`
          SELECT namespace, COUNT(*) AS count
          FROM facts
          WHERE registry_name = ?
          GROUP BY namespace
          ORDER BY namespace
        `, [registry]);

        return toolResult({
            registry,
            namespaces: rows,
            count: rows.length
        });
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('registry_metadata', {
    description: 'Get cloud-neutral Unifact registry metadata, capabilities, tenant isolation, and upstream configuration'
}, async () => {
    return toolResult(await getRegistryMetadata());
});

server.registerTool('list_facts', {
    description: 'List all facts in a namespace with full metadata',
    inputSchema: {
        namespace: z.string().min(1).describe('Namespace to list, for example company.decisions'),
        ...optionalRegistryField
    }
}, async ({ namespace, registry: registryArg }) => {
    try {
        const registry = await resolveToolRegistry(registryArg);
        const facts = (await listFacts(registry, namespace)).map(factFromRow);
        return toolResult({
            registry,
            namespace,
            facts,
            count: facts.length
        });
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('get_fact', {
    description: 'Get one fact by namespace and key with full metadata',
    inputSchema: {
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key'),
        ...optionalRegistryField
    }
}, async ({ namespace, key, registry: registryArg }) => {
    try {
        const registry = await resolveToolRegistry(registryArg);
        const row = await getFactRow(registry, namespace, key);

        if (!row) {
            return errorResult(`Fact '${key}' not found in namespace '${namespace}'`);
        }

        return toolResult({
            fact: factFromRow(row)
        });
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('search_facts', {
    description: 'Search facts (SQLite FTS5 locally; PostgreSQL plainto_tsquery on staging)',
    inputSchema: {
        query: z.string().min(1).describe('Full-text search query'),
        ...optionalRegistryField
    }
}, async ({ query, registry: registryArg }) => {
    try {
        const registry = await resolveToolRegistry(registryArg);
        const facts = (await searchFacts(registry, query)).map(factFromRow);
        return toolResult({
            query,
            facts,
            count: facts.length
        });
    } catch (err) {
        return errorResult(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
    }
});

server.registerTool('find_relevant_facts', {
    description: 'Find facts ranked for an agent profile, intent, subject, scope, and actionability',
    inputSchema: {
        profile_id: z.string().optional().describe('Agent profile id to rank facts for'),
        namespace: z.string().optional().describe('Optional namespace filter'),
        subject: z.string().optional().describe('Optional subject filter'),
        scope: z.string().optional().describe('Optional scope filter'),
        intent: z.string().optional().describe('Current task intent, for example triage or customer_communication'),
        actionability: z.enum(FACT_ACTIONABILITIES).optional().describe('Optional actionability filter'),
        fact_type: z.enum(FACT_TYPES).optional().describe('Optional fact type filter'),
        status: z.enum(FACT_STATUSES).optional().describe('Optional status filter'),
        include_inactive: z.boolean().optional().describe('Include stale, superseded, and retracted facts'),
        include_review: z.boolean().optional().describe('Include facts waiting for review'),
        limit: z.number().int().min(1).max(500).optional().describe('Maximum facts to return'),
        query: z.string().optional().describe('Optional full-text query'),
        registry_channel: z.enum(FACT_REGISTRY_CHANNELS).optional().describe('Optional registry channel filter'),
        published_only: z.boolean().optional().describe('Only return published facts'),
        ...optionalRegistryField
    }
}, async (args) => {
    try {
        const { registry: registryArg, ...query } = args;
        const registry = await resolveToolRegistry(registryArg);
        return toolResult(await findRelevantFacts({ ...query, registry_name: registry }));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});


server.registerTool('pull_facts_for_agent', {
    description: 'Pull published facts ranked for an agent profile and intent',
    inputSchema: {
        profile_id: z.string().min(1).describe('Agent profile id to pull facts for'),
        namespace: z.string().optional().describe('Optional namespace filter'),
        subject: z.string().optional().describe('Optional subject filter'),
        scope: z.string().optional().describe('Optional scope filter'),
        intent: z.string().optional().describe('Current task intent'),
        actionability: z.enum(FACT_ACTIONABILITIES).optional().describe('Optional actionability filter'),
        fact_type: z.enum(FACT_TYPES).optional().describe('Optional fact type filter'),
        status: z.enum(FACT_STATUSES).optional().describe('Optional status filter'),
        include_inactive: z.boolean().optional().describe('Include inactive facts'),
        include_review: z.boolean().optional().describe('Include facts waiting for review'),
        limit: z.number().int().min(1).max(500).optional().describe('Maximum facts to return'),
        query: z.string().optional().describe('Optional full-text query'),
        ...optionalRegistryField
    }
}, async (args) => {
    try {
        const { registry: registryArg, ...query } = args;
        const registry = await resolveToolRegistry(registryArg);
        return toolResult(await pullFactsForAgent({ ...query, registry_name: registry }));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});
server.registerTool('upsert_fact', {
    description: 'Create or update a fact with optional categorization, provenance, freshness, and actionability metadata',
    inputSchema: {
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key'),
        value: z.any()
            .refine(value => value !== undefined, { message: 'Value is required' })
            .describe('Value to store. Strings are stored as-is; other JSON values are stringified.'),
        ...factMetadataSchema,
        ...optionalRegistryField
    }
}, async (args) => {
    try {
        const { namespace, key, registry: registryArg, ...input } = args;
        const registry = await resolveToolRegistry(registryArg);
        return toolResult(await upsertFact(registry, namespace, key, input));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('propose_fact', {
    description: 'Create or update a fact through an agent profile, enforcing that profile\'s write permissions and review defaults',
    inputSchema: {
        profile_id: z.string().min(1).describe('Agent profile proposing the fact'),
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key'),
        value: z.any()
            .refine(value => value !== undefined, { message: 'Value is required' })
            .describe('Value to store. Strings are stored as-is; other JSON values are stringified.'),
        ...factMetadataSchema,
        ...optionalRegistryField
    }
}, async (args) => {
    try {
        const { profile_id, namespace, key, registry: registryArg, ...input } = args;
        const registry = await resolveToolRegistry(registryArg);
        return toolResult(await proposeFactFromProfile(registry, profile_id, namespace, key, input));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});


server.registerTool('list_fact_versions', {
    description: 'List version and lifecycle events for one fact',
    inputSchema: {
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key'),
        ...optionalRegistryField
    }
}, async ({ namespace, key, registry: registryArg }) => {
    try {
        const registry = await resolveToolRegistry(registryArg);
        return toolResult({ namespace, key, versions: await listFactVersions(registry, namespace, key) });
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('list_review_queue', {
    description: 'List proposed or reviewed facts waiting for curator approval',
    inputSchema: {
        namespace: z.string().optional().describe('Optional namespace filter'),
        limit: z.number().int().min(1).max(500).optional().describe('Maximum facts to return'),
        ...optionalRegistryField
    }
}, async (args) => {
    try {
        const { registry: registryArg, ...query } = args;
        const registry = await resolveToolRegistry(registryArg);
        return toolResult(await listReviewQueue({ ...query, registry_name: registry }));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('approve_fact', {
    description: 'Approve and publish a proposed fact in one curator action',
    inputSchema: {
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key'),
        reviewed_by: z.string().optional().describe('Reviewer or curator id'),
        change_reason: z.string().optional().describe('Approval reason'),
        ...optionalRegistryField
    }
}, async (args) => {
    try {
        const { namespace, key, registry: registryArg, ...input } = args;
        const registry = await resolveToolRegistry(registryArg);
        return toolResult(await approveFact(registry, namespace, key, input));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('reject_fact', {
    description: 'Reject a proposed fact and remove it from the published pull path',
    inputSchema: {
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key'),
        reviewed_by: z.string().optional().describe('Reviewer or curator id'),
        change_reason: z.string().optional().describe('Rejection reason'),
        ...optionalRegistryField
    }
}, async (args) => {
    try {
        const { namespace, key, registry: registryArg, ...input } = args;
        const registry = await resolveToolRegistry(registryArg);
        return toolResult(await rejectFact(registry, namespace, key, input));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('review_fact', {
    description: 'Review a proposed fact without publishing it yet',
    inputSchema: {
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key'),
        approved: z.boolean().optional().describe('Whether review approved the fact'),
        reviewed_by: z.string().optional().describe('Reviewer id'),
        change_reason: z.string().optional().describe('Review reason'),
        ...optionalRegistryField
    }
}, async (args) => {
    try {
        const { namespace, key, registry: registryArg, ...input } = args;
        const registry = await resolveToolRegistry(registryArg);
        return toolResult(await reviewFact(registry, namespace, key, input));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('publish_fact', {
    description: 'Publish a fact into the production published channel',
    inputSchema: {
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key'),
        published_by: z.string().optional().describe('Publisher id'),
        change_reason: z.string().optional().describe('Publish reason'),
        ...optionalRegistryField
    }
}, async (args) => {
    try {
        const { namespace, key, registry: registryArg, ...input } = args;
        const registry = await resolveToolRegistry(registryArg);
        return toolResult(await publishFact(registry, namespace, key, input));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('feedback_fact', {
    description: 'Owner opens a fact for feedback (visible to local agents; not production truth)',
    inputSchema: {
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key'),
        published_by: z.string().optional().describe('Owner / publisher id'),
        change_reason: z.string().optional().describe('Why feedback is requested'),
        ...optionalRegistryField
    }
}, async (args) => {
    try {
        const { namespace, key, registry: registryArg, ...input } = args;
        const registry = await resolveToolRegistry(registryArg);
        return toolResult(await feedbackFact(registry, namespace, key, input));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('supersede_fact', {
    description: 'Mark a fact as superseded by another fact path',
    inputSchema: {
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key'),
        superseded_by: z.string().min(1).describe('Replacement fact path'),
        change_reason: z.string().optional().describe('Supersession reason'),
        ...optionalRegistryField
    }
}, async (args) => {
    try {
        const { namespace, key, registry: registryArg, ...input } = args;
        const registry = await resolveToolRegistry(registryArg);
        return toolResult(await supersedeFact(registry, namespace, key, input));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('retract_fact', {
    description: 'Retract a fact from the registry',
    inputSchema: {
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key'),
        change_reason: z.string().optional().describe('Retraction reason'),
        ...optionalRegistryField
    }
}, async (args) => {
    try {
        const { namespace, key, registry: registryArg, ...input } = args;
        const registry = await resolveToolRegistry(registryArg);
        return toolResult(await retractFact(registry, namespace, key, input));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});
server.registerTool('delete_fact', {
    description: 'Delete a fact',
    inputSchema: {
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key'),
        ...optionalRegistryField
    }
}, async ({ namespace, key, registry: registryArg }) => {
    try {
        const registry = await resolveToolRegistry(registryArg);
        const deleted = await deleteFact(registry, namespace, key);
        if (!deleted) {
            return errorResult(`Fact '${key}' not found in namespace '${namespace}'`);
        }

        return toolResult({
            success: true,
            action: 'DELETE',
            namespace,
            key
        });
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('audit_fact', {
    description: 'Get audit history for one fact, including metadata snapshots when available',
    inputSchema: {
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key'),
        ...optionalRegistryField
    }
}, async ({ namespace, key, registry: registryArg }) => {
    try {
        const registry = await resolveToolRegistry(registryArg);
        const rows = await db.all<AuditLogRow>(`
          SELECT id, action, registry_name, namespace, key, old_value, new_value,
                 old_snapshot, new_snapshot, timestamp
          FROM audit_log
          WHERE registry_name = ? AND namespace = ? AND key = ?
          ORDER BY timestamp DESC
        `, [registry, namespace, key]);

        return toolResult({
            namespace,
            key,
            history: rows,
            count: rows.length
        });
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('list_agent_profiles', {
    description: 'List configured agent profiles and their fact/action permissions'
}, async () => {
    const profiles = await listAgentProfiles();
    return toolResult({ profiles, count: profiles.length });
});

server.registerTool('get_agent_profile', {
    description: 'Get one agent profile',
    inputSchema: {
        id: z.string().min(1).describe('Agent profile id')
    }
}, async ({ id }) => {
    const row = await getAgentProfileRow(id);
    if (!row) {
        return errorResult(`Agent profile '${id}' not found`);
    }

    const profiles = await listAgentProfiles();
    const profile = profiles.find(item => item.id === id);
    return toolResult({ profile });
});

server.registerTool('upsert_agent_profile', {
    description: 'Create or update an agent profile that controls which facts an agent uses, proposes, approves, and acts on',
    inputSchema: {
        id: z.string().min(1).describe('Stable profile id'),
        ...agentProfileSchema
    }
}, async (args) => {
    try {
        const { id, ...input } = args;
        return toolResult(await upsertAgentProfile(id, input));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('delete_agent_profile', {
    description: 'Delete an agent profile',
    inputSchema: {
        id: z.string().min(1).describe('Agent profile id')
    }
}, async ({ id }) => {
    const deleted = await deleteAgentProfile(id);
    if (!deleted) {
        return errorResult(`Agent profile '${id}' not found`);
    }

    return toolResult({ success: true, action: 'DELETE', id });
});

server.registerTool('sync_status', {
    description: 'Get upstream staging registry status and configuration'
}, async () => {
    try {
        return toolResult(await getSyncStatus());
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('sync_pull', {
    description: 'Pull published facts from the configured upstream registry',
    inputSchema: {
        namespaces: z.array(z.string()).optional().describe('Optional list of namespaces to pull')
    }
}, async ({ namespaces }) => {
    try {
        return toolResult(await pullFactsFromRemote(namespaces));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('sync_push', {
    description:
        'Push local facts upstream. Selectors may be namespaces, exact paths (ns/key), or globs (ns/pattern*).',
    inputSchema: {
        selectors: z
            .array(z.string())
            .optional()
            .describe('Optional selectors: policy, policy/feeling_talk, policy/feeling_*'),
        namespaces: z
            .array(z.string())
            .optional()
            .describe('Deprecated alias for selectors (namespace-only tokens)')
    }
}, async ({ selectors, namespaces }) => {
    try {
        return toolResult(await pushFactsToRemote(selectors ?? namespaces));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('UniFact MCP server running on stdio');
}

main().catch(err => {
    console.error('UniFact MCP server failed:', err);
    process.exit(1);
});

import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { db, AuditLogRow } from './db.js';
import {
    deleteAgentProfile,
    deleteFact,
    factFromRow,
    findRelevantFacts,
    getAgentProfileRow,
    getFactRow,
    listAgentProfiles,
    listFacts,
    proposeFactFromProfile,
    searchFacts,
    upsertAgentProfile,
    upsertFact
} from './store.js';
import {
    FACT_ACTIONABILITIES,
    FACT_APPROVAL_STATUSES,
    FACT_DERIVATIONS,
    FACT_PRIORITIES,
    FACT_STATUSES,
    FACT_TYPES
} from './model.js';

type JsonObject = Record<string, unknown>;

const server = new McpServer({
    name: 'unifact',
    version: '0.2.0'
});

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
    approval_status: z.enum(FACT_APPROVAL_STATUSES).optional().describe('Review status')
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
    description: 'List namespaces in the UniFact store with fact counts'
}, async () => {
    const rows = db.prepare(`
      SELECT namespace, COUNT(*) AS count
      FROM facts
      GROUP BY namespace
      ORDER BY namespace
    `).all() as { namespace: string; count: number }[];

    return toolResult({
        namespaces: rows,
        count: rows.length
    });
});

server.registerTool('list_facts', {
    description: 'List all facts in a namespace with full metadata',
    inputSchema: {
        namespace: z.string().min(1).describe('Namespace to list, for example company.decisions')
    }
}, async ({ namespace }) => {
    const facts = listFacts(namespace).map(factFromRow);
    return toolResult({
        namespace,
        facts,
        count: facts.length
    });
});

server.registerTool('get_fact', {
    description: 'Get one fact by namespace and key with full metadata',
    inputSchema: {
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key')
    }
}, async ({ namespace, key }) => {
    const row = getFactRow(namespace, key);

    if (!row) {
        return errorResult(`Fact '${key}' not found in namespace '${namespace}'`);
    }

    return toolResult({
        fact: factFromRow(row)
    });
});

server.registerTool('search_facts', {
    description: 'Search facts using SQLite FTS5 query syntax',
    inputSchema: {
        query: z.string().min(1).describe('Full-text search query')
    }
}, async ({ query }) => {
    try {
        const facts = searchFacts(query).map(factFromRow);
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
        query: z.string().optional().describe('Optional full-text query')
    }
}, async (args) => {
    try {
        return toolResult(findRelevantFacts(args));
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
        ...factMetadataSchema
    }
}, async (args) => {
    try {
        const { namespace, key, ...input } = args;
        return toolResult(upsertFact(namespace, key, input));
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
        ...factMetadataSchema
    }
}, async (args) => {
    try {
        const { profile_id, namespace, key, ...input } = args;
        return toolResult(proposeFactFromProfile(profile_id, namespace, key, input));
    } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
    }
});

server.registerTool('delete_fact', {
    description: 'Delete a fact',
    inputSchema: {
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key')
    }
}, async ({ namespace, key }) => {
    const deleted = deleteFact(namespace, key);
    if (!deleted) {
        return errorResult(`Fact '${key}' not found in namespace '${namespace}'`);
    }

    return toolResult({
        success: true,
        action: 'DELETE',
        namespace,
        key
    });
});

server.registerTool('audit_fact', {
    description: 'Get audit history for one fact, including metadata snapshots when available',
    inputSchema: {
        namespace: z.string().min(1).describe('Fact namespace'),
        key: z.string().min(1).describe('Fact key')
    }
}, async ({ namespace, key }) => {
    const rows = db.prepare(`
      SELECT id, action, namespace, key, old_value, new_value,
             old_snapshot, new_snapshot, timestamp
      FROM audit_log
      WHERE namespace = ? AND key = ?
      ORDER BY timestamp DESC
    `).all(namespace, key) as AuditLogRow[];

    return toolResult({
        namespace,
        key,
        history: rows,
        count: rows.length
    });
});

server.registerTool('list_agent_profiles', {
    description: 'List configured agent profiles and their fact/action permissions'
}, async () => {
    const profiles = listAgentProfiles();
    return toolResult({ profiles, count: profiles.length });
});

server.registerTool('get_agent_profile', {
    description: 'Get one agent profile',
    inputSchema: {
        id: z.string().min(1).describe('Agent profile id')
    }
}, async ({ id }) => {
    const row = getAgentProfileRow(id);
    if (!row) {
        return errorResult(`Agent profile '${id}' not found`);
    }

    const profile = listAgentProfiles().find(item => item.id === id);
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
        return toolResult(upsertAgentProfile(id, input));
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
    const deleted = deleteAgentProfile(id);
    if (!deleted) {
        return errorResult(`Agent profile '${id}' not found`);
    }

    return toolResult({ success: true, action: 'DELETE', id });
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
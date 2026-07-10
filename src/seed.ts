import { upsertAgentProfile, upsertFact } from './store.js';

interface SeedFact extends Record<string, unknown> {
    namespace: string;
    key: string;
    value: string;
    description: string;
}

interface SeedAgentProfile extends Record<string, unknown> {
    id: string;
    name: string;
    role: string;
}

const SEED_FACTS: SeedFact[] = [
    {
        namespace: 'company.decisions',
        key: 'chatbot-knowledge',
        value: 'Prompt stuffing used for dahg-ai instead of S3/vector DBs.',
        description: 'Decision logging seed: dahg-ai starts with prompt stuffing because it is simpler and enough for the current knowledge base.',
        fact_type: 'decision_fact',
        subject: 'dahg-ai',
        scope: 'company',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent', 'customer-information-agent'],
        relevance_tags: ['planning', 'architecture', 'migration'],
        priority: 'normal',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.decisions',
        key: 'unifact-backend',
        value: 'SQLite + FTS5 chosen over DynamoDB.',
        description: 'UniFact Day 1 uses local-first SQLite with built-in full-text search before adding remote infrastructure.',
        fact_type: 'decision_fact',
        subject: 'unifact',
        scope: 'platform',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent', 'coding-agent'],
        relevance_tags: ['architecture', 'local-first'],
        priority: 'normal',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.decisions',
        key: 'unifact-name',
        value: 'Product named UniFact (unifact.ai), chat agent named Uni.',
        description: 'Branding decision: UniFact is the product, Uni is the chat agent, and customer-facing agents can be white-labeled.',
        fact_type: 'decision_fact',
        subject: 'unifact',
        scope: 'brand',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent'],
        relevance_tags: ['brand', 'customer-communication'],
        priority: 'normal',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.decisions',
        key: 'dahg-ai-migration',
        value: 'dahg-ai to be bootstrapped on top of UniFact, not rewritten.',
        description: 'Migration strategy keeps the existing dahg-ai direction while moving durable facts into UniFact.',
        fact_type: 'decision_fact',
        subject: 'dahg-ai',
        scope: 'platform',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent', 'coding-agent'],
        relevance_tags: ['migration', 'architecture'],
        priority: 'normal',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.decisions',
        key: 'unifact-skills',
        value: 'Reusable skills defined as company.skills/*.',
        description: 'Skills are reusable company-level facts and capabilities that agents compose rather than own directly.',
        fact_type: 'decision_fact',
        subject: 'unifact',
        scope: 'platform',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent', 'coding-agent'],
        relevance_tags: ['skills', 'agent-composition'],
        priority: 'normal',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.decisions',
        key: 'unifact-universal-agents',
        value: 'UniFact is a shared fact layer for universal agents, not only coding agents.',
        description: 'Product direction: one agent discovery should become reusable context for other agents across customer, support, operations, finance, implementation, reporting, and coding workflows.',
        fact_type: 'decision_fact',
        subject: 'unifact',
        scope: 'product',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent', 'operations-agent', 'coding-agent'],
        relevance_tags: ['positioning', 'agent-coordination'],
        priority: 'high',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.insights',
        key: 'derived-operational-facts',
        value: 'Operational metrics and simplified insights can be stored as derived facts, while raw transactional data should stay in source systems.',
        description: 'Boundary for UniFact: capture trusted, simplified conclusions that agents can reuse; avoid becoming a data warehouse or event store.',
        fact_type: 'insight_fact',
        subject: 'operational-facts',
        scope: 'product',
        derivation: 'derived',
        actionability: 'consider_before_action',
        audience: ['general-agent', 'operations-agent', 'customer-information-agent'],
        relevance_tags: ['operations', 'reporting', 'agent-context'],
        priority: 'high',
        approval_status: 'approved',
        created_by: 'seed'
    }
];

const SEED_AGENT_PROFILES: SeedAgentProfile[] = [
    {
        id: 'customer-information-agent',
        name: 'Customer Information Agent',
        description: 'Reads durable customer context and produces reusable customer summaries without taking external action.',
        role: 'customer-information-agent',
        allowed_fact_types: ['entity_fact', 'state_fact', 'preference_fact', 'constraint_fact', 'decision_fact', 'insight_fact'],
        writable_fact_types: ['entity_fact', 'state_fact', 'insight_fact'],
        relevant_scopes: ['customer', 'company', 'product', 'support'],
        relevant_subjects: ['*'],
        intents: ['customer_context', 'summary', 'handoff', 'investigation'],
        audience_tags: ['customer-information-agent', 'general-agent'],
        can_propose_facts: true,
        can_approve_facts: false,
        allowed_actions: [],
        requires_human_approval_for: ['requires_action', 'blocks_action']
    },
    {
        id: 'support-agent',
        name: 'Support Agent',
        description: 'Uses customer state, constraints, preferences, and blockers to triage issues and draft customer-safe responses.',
        role: 'support-agent',
        allowed_fact_types: ['entity_fact', 'state_fact', 'preference_fact', 'constraint_fact', 'actionable_fact', 'decision_fact'],
        writable_fact_types: ['state_fact', 'actionable_fact', 'insight_fact'],
        relevant_scopes: ['customer', 'support', 'product'],
        relevant_subjects: ['*'],
        intents: ['triage', 'customer_communication', 'escalation', 'handoff'],
        audience_tags: ['support-agent', 'customer-information-agent'],
        can_propose_facts: true,
        can_approve_facts: false,
        allowed_actions: ['draft_customer_reply', 'create_escalation_note'],
        requires_human_approval_for: ['customer_contact', 'requires_action', 'blocks_action']
    },
    {
        id: 'operations-analyst-agent',
        name: 'Operations Analyst Agent',
        description: 'Turns activity across systems into simplified operational insight facts for planning and improvement.',
        role: 'operations-analyst-agent',
        allowed_fact_types: ['state_fact', 'insight_fact', 'decision_fact', 'constraint_fact', 'actionable_fact'],
        writable_fact_types: ['insight_fact', 'actionable_fact'],
        relevant_scopes: ['operations', 'support', 'finance', 'customer', 'product'],
        relevant_subjects: ['*'],
        intents: ['reporting', 'planning', 'bottleneck_analysis', 'operational_efficiency'],
        audience_tags: ['operations-agent', 'general-agent'],
        can_propose_facts: true,
        can_approve_facts: false,
        allowed_actions: ['create_report', 'recommend_action'],
        requires_human_approval_for: ['requires_action', 'blocks_action']
    },
    {
        id: 'workflow-execution-agent',
        name: 'Workflow Execution Agent',
        description: 'Acts on approved workflow facts while respecting constraints, decisions, and human approval gates.',
        role: 'workflow-execution-agent',
        allowed_fact_types: ['state_fact', 'constraint_fact', 'decision_fact', 'actionable_fact', 'preference_fact'],
        writable_fact_types: ['state_fact', 'actionable_fact'],
        relevant_scopes: ['operations', 'support', 'customer', 'finance', 'product'],
        relevant_subjects: ['*'],
        intents: ['execution', 'handoff', 'approval', 'follow_up'],
        audience_tags: ['workflow-execution-agent', 'operations-agent'],
        can_propose_facts: true,
        can_approve_facts: false,
        allowed_actions: ['update_source_system', 'create_task', 'draft_message'],
        requires_human_approval_for: ['customer_contact', 'external_system_write', 'blocks_action']
    },
    {
        id: 'curator-agent',
        name: 'Curator Agent',
        description: 'Reviews proposed facts, approves trusted facts, and keeps the shared fact layer clean.',
        role: 'curator-agent',
        allowed_fact_types: ['entity_fact', 'state_fact', 'insight_fact', 'decision_fact', 'constraint_fact', 'preference_fact', 'actionable_fact'],
        writable_fact_types: ['entity_fact', 'state_fact', 'insight_fact', 'decision_fact', 'constraint_fact', 'preference_fact', 'actionable_fact'],
        relevant_scopes: ['*'],
        relevant_subjects: ['*'],
        intents: ['review', 'approval', 'deduplication', 'supersession'],
        audience_tags: ['curator-agent', 'general-agent'],
        can_propose_facts: true,
        can_approve_facts: true,
        allowed_actions: ['approve_fact', 'reject_fact', 'mark_stale', 'supersede_fact'],
        requires_human_approval_for: ['policy_change', 'customer_contact']
    }
];

function runSeed() {
    console.log('Seeding UniFact baseline facts and agent profiles...');

    for (const item of SEED_FACTS) {
        const { namespace, key, ...input } = item;
        const result = upsertFact(namespace, key, input);
        console.log(`${result.action}: ${namespace}/${key}`);
    }

    for (const profile of SEED_AGENT_PROFILES) {
        const { id, ...input } = profile;
        const result = upsertAgentProfile(id, input);
        console.log(`${result.action}: agent profile ${id}`);
    }

    console.log('Seeding complete.');
}

try {
    runSeed();
} catch (err) {
    console.error('Failed to run seed script:', err);
    process.exitCode = 1;
}
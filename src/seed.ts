import { upsertAgentProfile, upsertFact } from './store.js';
import { getRegistry, initRegistry, requireWorkingRegistry } from './registry.js';
import { getActiveLocalApiKey } from './keys.js';

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
        value: 'SQLite + FTS5 is the local working-store backend; origin/remote/host registry uses PostgreSQL.',
        description: 'Storage choice is deployment topology, not product identity: local agents use SQLite; the shared origin registry uses managed PostgreSQL on any host. DynamoDB is no longer the planned hosted registry backend.',
        fact_type: 'decision_fact',
        subject: 'unifact',
        scope: 'platform',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent', 'coding-agent', 'builder-agent', 'operations-agent'],
        relevance_tags: ['architecture', 'local-first', 'storage-adapter', 'postgres', 'sqlite'],
        priority: 'critical',
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
        namespace: 'company.branding',
        key: 'tagline',
        value: 'One Fact. One Truth.',
        description: 'Official tagline for UniFact: every organization should have one authoritative fact about every piece of knowledge.',
        fact_type: 'decision_fact',
        subject: 'unifact',
        scope: 'brand',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent', 'builder-agent', 'coding-agent'],
        relevance_tags: ['brand', 'marketing', 'positioning'],
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
        key: 'unifact-public-product-name',
        value: 'Unifact is the end-user product and agent-facing fact registry; Dahg-ai is only an internal project name.',
        description: 'Dahg-ai may appear in internal project history, but customer-facing surfaces, APIs, registry language, and agent integrations should use Unifact.',
        fact_type: 'decision_fact',
        subject: 'unifact',
        scope: 'brand',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent', 'builder-agent', 'coding-agent'],
        relevance_tags: ['brand', 'positioning', 'customer-communication'],
        priority: 'critical',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.decisions',
        key: 'unifact-storage-topology',
        value: 'Unifact is the fact API, model, and registry lifecycle; SQLite is the local adapter and PostgreSQL is the origin/remote/host adapter.',
        description: 'Use SQLite for local working stores and PostgreSQL for the shared origin registry while preserving one Unifact API/MCP contract for agents.',
        fact_type: 'decision_fact',
        subject: 'unifact',
        scope: 'architecture',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent', 'builder-agent', 'coding-agent', 'operations-agent'],
        relevance_tags: ['architecture', 'storage-adapter', 'registry', 'postgres', 'sqlite'],
        priority: 'critical',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.decisions',
        key: 'unifact-origin-storage',
        value: 'Origin/remote/host UniFact registry stores facts in PostgreSQL.',
        description: 'Local instances keep SQLite working stores and sync to a Postgres-backed origin. Do not put database passwords in facts; connection secrets stay in env/secret config. Cloud vendor is an ops choice, not product identity.',
        fact_type: 'decision_fact',
        subject: 'unifact',
        scope: 'architecture',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent', 'builder-agent', 'coding-agent', 'operations-agent'],
        relevance_tags: ['architecture', 'origin', 'postgres', 'aws', 'registry'],
        priority: 'critical',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.decisions',
        key: 'unifact-hosting',
        value: 'Hosted UniFact origin uses managed PostgreSQL; local stays SQLite. Compute may be any VM, container, or PaaS.',
        description: 'Prefer managed PostgreSQL for the shared registry. Where you run the UniFact API process is separate from the database and is not tied to one cloud vendor.',
        fact_type: 'decision_fact',
        subject: 'unifact',
        scope: 'infrastructure',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent', 'builder-agent', 'coding-agent', 'operations-agent'],
        relevance_tags: ['infrastructure', 'hosting', 'postgres', 'aws'],
        priority: 'critical',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.decisions',
        key: 'unifact-registry-lifecycle',
        value: 'Facts move from working/proposed/review channels into a published central registry, and agents pull published facts relevant to their operations.',
        description: 'Unifact is a DB-backed fact registry with Git-like lifecycle semantics: propose, review, publish, supersede, retract, history, and pull.',
        fact_type: 'decision_fact',
        subject: 'unifact',
        scope: 'product',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent', 'builder-agent', 'coding-agent', 'operations-agent'],
        relevance_tags: ['registry', 'publish', 'pull', 'agent-coordination'],
        priority: 'critical',
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
    },
    {
        namespace: 'company.constraints',
        key: 'work_session_fact_check',
        value: 'Work agents (Cursor, Codex, Claude, Devin, Antigravity, Cowork, and similar) must run a Fact Check via UniFact MCP before work that depends on org truth.',
        description: 'Before changing systems or asserting procedure, retrieve relevant decision, constraint, architecture, naming, and product facts so work does not contradict published registry truth.',
        fact_type: 'constraint_fact',
        subject: 'work-session',
        scope: 'organization',
        derivation: 'asserted',
        actionability: 'constraint',
        audience: ['work-agent', 'builder-agent'],
        relevance_tags: ['fact_check', 'preflight', 'mcp'],
        priority: 'critical',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.constraints',
        key: 'work_agent_mcp_interface',
        value: 'UniFact MCP is the shared interface for all work agents to read and propose org facts; do not treat README or source exploration as the default source of org truth.',
        description: 'Configure MCP from docs/mcp.md. Same stdio server for Cursor, Claude, Codex, Devin, Antigravity, and other MCP hosts.',
        fact_type: 'constraint_fact',
        subject: 'work-agent',
        scope: 'organization',
        derivation: 'asserted',
        actionability: 'constraint',
        audience: ['work-agent', 'builder-agent', 'operations-agent'],
        relevance_tags: ['mcp', 'fact_check', 'agent_interface'],
        priority: 'critical',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.constraints',
        key: 'work_session_git_pull',
        value: 'Work agents must run git pull before starting repository code changes.',
        description: 'Before editing code, sync the current branch from its configured upstream. If no upstream is configured, record that pull was attempted and why it could not complete.',
        fact_type: 'constraint_fact',
        subject: 'work-session',
        scope: 'repository',
        derivation: 'asserted',
        actionability: 'constraint',
        audience: ['work-agent', 'builder-agent'],
        relevance_tags: ['repo_sync', 'git_pull', 'preflight'],
        priority: 'critical',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.decisions',
        key: 'unifact-sync-architecture',
        value: 'Unifact uses cloud-neutral upstream staging registries for proposed facts, with tenant inferred from API key.',
        description: 'Agents push proposed facts to the configured Unifact upstream registry endpoint. The endpoint may be Unifact-hosted or customer-hosted, but agents should not depend on the cloud provider behind it.',
        fact_type: 'decision_fact',
        subject: 'unifact',
        scope: 'architecture',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent', 'builder-agent', 'coding-agent', 'operations-agent'],
        relevance_tags: ['staging', 'review', 'tenant-isolation', 'upstream-registry'],
        priority: 'critical',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.decisions',
        key: 'unifact-remote-configuration',
        value: 'Local Unifact stores a cloud-neutral upstream registry URL, not an upstream cloud provider fact.',
        description: 'Local instances configure the upstream staging or registry endpoint through company.infrastructure/upstream-registry-url, with credentials in secret configuration. Cloud provider details remain upstream metadata for admin/operator workflows.',
        fact_type: 'decision_fact',
        subject: 'unifact',
        scope: 'configuration',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent', 'builder-agent', 'coding-agent', 'operations-agent'],
        relevance_tags: ['configuration', 'upstream-registry', 'cloud-neutral', 'facts-as-config'],
        priority: 'high',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.decisions',
        key: 'unifact-sync-workflow',
        value: 'Builder agents propose facts; curator/review agents approve or reject them before publication.',
        description: 'Review workflow is a handoff between agent profiles: builders propose, curators inspect the review queue, approve or reject, and published facts become available through normal agent pull.',
        fact_type: 'decision_fact',
        subject: 'unifact',
        scope: 'workflow',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['general-agent', 'builder-agent', 'coding-agent'],
        relevance_tags: ['review', 'workflow', 'agent-handoff', 'lifecycle'],
        priority: 'high',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.infrastructure',
        key: 'upstream-registry-url',
        value: 'https://staging.unifact.ai',
        description: 'Upstream Unifact registry URL for pull/push and org mirror. Staging uses Lets Encrypt TLS (see company.infrastructure/staging-tls).',
        fact_type: 'entity_fact',
        subject: 'unifact-registry',
        scope: 'infrastructure',
        derivation: 'asserted',
        actionability: 'informational',
        audience: ['general-agent', 'builder-agent', 'coding-agent', 'operations-agent'],
        relevance_tags: ['infrastructure', 'staging', 'upstream-registry'],
        priority: 'high',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.infrastructure',
        key: 'upstream-registry-role',
        value: 'staging',
        description: 'Configured upstream registry role. Local agents treat this as a Unifact endpoint role, not as a cloud provider or storage backend.',
        fact_type: 'entity_fact',
        subject: 'unifact-registry',
        scope: 'infrastructure',
        derivation: 'asserted',
        actionability: 'informational',
        audience: ['general-agent', 'builder-agent', 'coding-agent', 'operations-agent'],
        relevance_tags: ['infrastructure', 'staging', 'upstream-registry'],
        priority: 'normal',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.infrastructure',
        key: 'staging-host-ip',
        value: '98.89.187.199',
        description: 'Public A record target for staging.unifact.ai (Lightsail compute).',
        fact_type: 'entity_fact',
        subject: 'unifact-staging',
        scope: 'infrastructure',
        derivation: 'asserted',
        actionability: 'informational',
        audience: ['operations-agent', 'coding-agent', 'builder-agent'],
        relevance_tags: ['infrastructure', 'staging', 'lightsail', 'deploy'],
        priority: 'high',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.infrastructure',
        key: 'staging-ssh-user',
        value: 'admin',
        description: 'SSH login user on staging.unifact.ai (Lightsail Node instance). Not ubuntu/ec2-user.',
        fact_type: 'entity_fact',
        subject: 'unifact-staging',
        scope: 'infrastructure',
        derivation: 'asserted',
        actionability: 'informational',
        audience: ['operations-agent', 'coding-agent', 'builder-agent'],
        relevance_tags: ['infrastructure', 'staging', 'ssh', 'deploy'],
        priority: 'critical',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.infrastructure',
        key: 'staging-ssh-key-path',
        value: 'C:\\Users\\admin\\git\\LightsailDefaultKey-us-east-1.pem',
        description: 'Path to the Lightsail default SSH private key on the operator laptop (under the git parent folder). Store the PATH only — never commit PEM contents into the UniFact repo.',
        fact_type: 'entity_fact',
        subject: 'unifact-staging',
        scope: 'infrastructure',
        derivation: 'asserted',
        actionability: 'informational',
        audience: ['operations-agent', 'coding-agent', 'builder-agent'],
        relevance_tags: ['infrastructure', 'staging', 'ssh', 'pem', 'deploy', 'secrets-path'],
        priority: 'critical',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.infrastructure',
        key: 'staging-app-dir',
        value: '/var/www/unifact',
        description: 'UniFact origin app directory on staging. Runs dist/api.js under pm2 name unifact. Host has no git — deploy by syncing built files.',
        fact_type: 'entity_fact',
        subject: 'unifact-staging',
        scope: 'infrastructure',
        derivation: 'asserted',
        actionability: 'informational',
        audience: ['operations-agent', 'coding-agent', 'builder-agent'],
        relevance_tags: ['infrastructure', 'staging', 'deploy', 'pm2'],
        priority: 'critical',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.infrastructure',
        key: 'staging-process-manager',
        value: 'pm2 (root) — app name unifact; ecosystem.config.cjs loads .env; restart with: sudo pm2 restart unifact && sudo pm2 save',
        description: 'Process supervision for staging UniFact API. pm2-root.service keeps processes across reboot.',
        fact_type: 'entity_fact',
        subject: 'unifact-staging',
        scope: 'infrastructure',
        derivation: 'asserted',
        actionability: 'informational',
        audience: ['operations-agent', 'coding-agent'],
        relevance_tags: ['infrastructure', 'staging', 'pm2', 'deploy'],
        priority: 'high',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.infrastructure',
        key: 'unifact-local-repo',
        value: 'C:\\Users\\admin\\git\\unifact',
        description: 'Operator laptop checkout of the UniFact engine repo used to build and deploy staging.',
        fact_type: 'entity_fact',
        subject: 'unifact',
        scope: 'infrastructure',
        derivation: 'asserted',
        actionability: 'informational',
        audience: ['operations-agent', 'coding-agent', 'builder-agent'],
        relevance_tags: ['infrastructure', 'deploy', 'repo'],
        priority: 'high',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.infrastructure',
        key: 'unifact-github-remote',
        value: 'https://github.com/baskcart/unifact.git',
        description: 'Canonical GitHub remote for UniFact (git remote name often unifact).',
        fact_type: 'entity_fact',
        subject: 'unifact',
        scope: 'infrastructure',
        derivation: 'asserted',
        actionability: 'informational',
        audience: ['operations-agent', 'coding-agent', 'builder-agent'],
        relevance_tags: ['infrastructure', 'github', 'deploy'],
        priority: 'normal',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.infrastructure',
        key: 'unifact-deploy-script',
        value: 'scripts/deploy-staging.ps1 (Windows) or scripts/deploy-staging.sh (bash)',
        description: 'Deploy scripts in the UniFact repo. Build locally, sync to staging-app-dir (preserve .env), npm install --omit=dev, sudo pm2 restart unifact.',
        fact_type: 'entity_fact',
        subject: 'unifact-staging',
        scope: 'infrastructure',
        derivation: 'asserted',
        actionability: 'informational',
        audience: ['operations-agent', 'coding-agent', 'builder-agent'],
        relevance_tags: ['infrastructure', 'staging', 'deploy', 'script'],
        priority: 'critical',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.infrastructure',
        key: 'staging-proxy',
        value: 'Co-hosted nodeapp (pm2 name nodeapp, /var/www/nodeapp) fronts HTTP(S); UniFact API listens on 127.0.0.1:4110. Optional scripts/lightsail-proxy.js pattern: 80/443 → 4110.',
        description: 'How external traffic reaches UniFact on staging.',
        fact_type: 'entity_fact',
        subject: 'unifact-staging',
        scope: 'infrastructure',
        derivation: 'asserted',
        actionability: 'informational',
        audience: ['operations-agent', 'coding-agent'],
        relevance_tags: ['infrastructure', 'staging', 'proxy', 'tls'],
        priority: 'normal',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.decisions',
        key: 'unifact-staging-deploy',
        value: 'Deploy staging by building on the operator laptop, syncing artifacts to /var/www/unifact (never overwrite .env), npm install on host, sudo pm2 restart unifact. Staging has no git binary — do not rely on git pull on the server.',
        description: 'Operational deploy procedure for staging.unifact.ai. SSH as admin with LightsailDefaultKey-us-east-1.pem. Scripts: scripts/deploy-staging.ps1 / scripts/deploy-staging.sh.',
        fact_type: 'decision_fact',
        subject: 'unifact',
        scope: 'infrastructure',
        derivation: 'asserted',
        actionability: 'decision_record',
        audience: ['operations-agent', 'coding-agent', 'builder-agent'],
        relevance_tags: ['deploy', 'staging', 'pm2', 'lightsail', 'procedure'],
        priority: 'critical',
        approval_status: 'approved',
        created_by: 'seed'
    },
    {
        namespace: 'company.constraints',
        key: 'unifact-pem-path-only',
        value: 'Record SSH PEM file PATH as a fact (company.infrastructure/staging-ssh-key-path). Never commit the PEM file or paste private key material into the repo, chat logs, or published fact values.',
        description: 'Security constraint for operator credentials used to deploy UniFact staging.',
        fact_type: 'constraint_fact',
        subject: 'unifact-staging',
        scope: 'security',
        derivation: 'asserted',
        actionability: 'blocks_action',
        audience: ['operations-agent', 'coding-agent', 'builder-agent'],
        relevance_tags: ['security', 'pem', 'secrets', 'deploy'],
        priority: 'critical',
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
        id: 'builder-agent',
        name: 'Builder Agent',
        description: 'Plans and edits code after checking shared facts, syncing the repository, and respecting project decisions and constraints.',
        role: 'builder-agent',
        allowed_fact_types: ['entity_fact', 'state_fact', 'insight_fact', 'decision_fact', 'constraint_fact', 'preference_fact', 'actionable_fact'],
        writable_fact_types: ['state_fact', 'insight_fact', 'decision_fact', 'constraint_fact', 'actionable_fact'],
        relevant_scopes: ['repository', 'platform', 'product', 'company', 'architecture', 'brand'],
        relevant_subjects: ['*'],
        intents: ['fact_check', 'repo_sync', 'code_change', 'implementation', 'review', 'testing', 'commit'],
        audience_tags: ['builder-agent', 'coding-agent', 'general-agent'],
        can_propose_facts: true,
        can_approve_facts: false,
        allowed_actions: ['read_relevant_facts', 'git_pull', 'edit_code', 'run_tests', 'commit_changes'],
        requires_human_approval_for: ['destructive_git_action', 'external_system_write', 'production_deploy']
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

async function runSeed() {
    console.log('Seeding UniFact baseline facts and agent profiles...');

    let registryName: string;
    try {
        registryName = await requireWorkingRegistry((await getActiveLocalApiKey())?.person ?? null);
    } catch {
        const existing = await getRegistry('Unifact');
        if (existing) {
            registryName = existing.name;
        } else {
            const person = (await getActiveLocalApiKey())?.person ?? 'seed';
            const created = await initRegistry({
                name: 'Unifact',
                person,
                description: 'Default seed registry',
                syncRemote: false
            });
            registryName = created.registry.name;
            console.log(`Initialized registry '${registryName}' for seeding`);
        }
    }

    for (const item of SEED_FACTS) {
        const { namespace, key, ...input } = item;
        const result = await upsertFact(registryName, namespace, key, {
            ...input,
            registry_channel: 'published',
            published_by: 'seed',
            published_at: Date.now(),
            _event: 'publish'
        });
        console.log(`${result.action}: ${namespace}/${key}`);
    }

    for (const profile of SEED_AGENT_PROFILES) {
        const { id, ...input } = profile;
        const result = await upsertAgentProfile(id, input);
        console.log(`${result.action}: agent profile ${id}`);
    }

    console.log('Seeding complete.');
}

runSeed().catch(err => {
    console.error('Failed to run seed script:', err);
    process.exitCode = 1;
});

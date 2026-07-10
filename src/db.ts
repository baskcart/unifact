import 'dotenv/config';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'store.db');

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');

function ensureColumns(table: string, columns: { name: string; definition: string }[]) {
    const existingColumns = new Set(
        (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
            .map(column => column.name)
    );

    for (const column of columns) {
        if (!existingColumns.has(column.name)) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.definition}`);
        }
    }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS facts (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(namespace, key)
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    old_snapshot TEXT,
    new_snapshot TEXT,
    timestamp INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fact_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    version INTEGER NOT NULL,
    event TEXT NOT NULL,
    registry_channel TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    author TEXT,
    change_reason TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    role TEXT NOT NULL,
    allowed_fact_types TEXT NOT NULL DEFAULT '[]',
    writable_fact_types TEXT NOT NULL DEFAULT '[]',
    relevant_scopes TEXT NOT NULL DEFAULT '[]',
    relevant_subjects TEXT NOT NULL DEFAULT '[]',
    intents TEXT NOT NULL DEFAULT '[]',
    audience_tags TEXT NOT NULL DEFAULT '[]',
    can_propose_facts INTEGER NOT NULL DEFAULT 1,
    can_approve_facts INTEGER NOT NULL DEFAULT 0,
    allowed_actions TEXT NOT NULL DEFAULT '[]',
    requires_human_approval_for TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

ensureColumns('facts', [
    { name: 'fact_type', definition: "TEXT NOT NULL DEFAULT 'entity_fact'" },
    { name: 'subject', definition: 'TEXT' },
    { name: 'scope', definition: 'TEXT' },
    { name: 'status', definition: "TEXT NOT NULL DEFAULT 'active'" },
    { name: 'derivation', definition: "TEXT NOT NULL DEFAULT 'asserted'" },
    { name: 'confidence', definition: 'REAL' },
    { name: 'source', definition: 'TEXT' },
    { name: 'evidence', definition: 'TEXT' },
    { name: 'valid_from', definition: 'INTEGER' },
    { name: 'valid_until', definition: 'INTEGER' },
    { name: 'observed_at', definition: 'INTEGER' },
    { name: 'time_period', definition: 'TEXT' },
    { name: 'audience', definition: 'TEXT' },
    { name: 'relevance_tags', definition: 'TEXT' },
    { name: 'actionability', definition: "TEXT NOT NULL DEFAULT 'informational'" },
    { name: 'owner', definition: 'TEXT' },
    { name: 'priority', definition: "TEXT NOT NULL DEFAULT 'normal'" },
    { name: 'related_facts', definition: 'TEXT' },
    { name: 'created_by', definition: 'TEXT' },
    { name: 'approved_by', definition: 'TEXT' },
    { name: 'approval_status', definition: "TEXT NOT NULL DEFAULT 'unreviewed'" },
    { name: 'registry_channel', definition: "TEXT NOT NULL DEFAULT 'working'" },
    { name: 'version', definition: 'INTEGER NOT NULL DEFAULT 1' },
    { name: 'published_at', definition: 'INTEGER' },
    { name: 'published_by', definition: 'TEXT' },
    { name: 'change_reason', definition: 'TEXT' },
    { name: 'supersedes', definition: 'TEXT' },
    { name: 'superseded_by', definition: 'TEXT' }
]);

ensureColumns('audit_log', [
    { name: 'old_snapshot', definition: 'TEXT' },
    { name: 'new_snapshot', definition: 'TEXT' }
]);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_facts_namespace ON facts(namespace);
  CREATE INDEX IF NOT EXISTS idx_facts_type ON facts(fact_type);
  CREATE INDEX IF NOT EXISTS idx_facts_status ON facts(status);
  CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject);
  CREATE INDEX IF NOT EXISTS idx_facts_scope ON facts(scope);
  CREATE INDEX IF NOT EXISTS idx_facts_actionability ON facts(actionability);
  CREATE INDEX IF NOT EXISTS idx_facts_registry_channel ON facts(registry_channel);
  CREATE INDEX IF NOT EXISTS idx_facts_version ON facts(namespace, key, version);
  CREATE INDEX IF NOT EXISTS idx_fact_versions_fact ON fact_versions(namespace, key, version);
  CREATE INDEX IF NOT EXISTS idx_fact_versions_event ON fact_versions(event);
  CREATE INDEX IF NOT EXISTS idx_agent_profiles_role ON agent_profiles(role);
`);

try {
    db.exec(`
      DROP TRIGGER IF EXISTS facts_ai;
      DROP TRIGGER IF EXISTS facts_ad;
      DROP TRIGGER IF EXISTS facts_au;
      DROP TABLE IF EXISTS facts_fts;

      CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
        namespace,
        key,
        value,
        description,
        fact_type,
        subject,
        scope,
        status,
        derivation,
        source,
        evidence,
        time_period,
        audience,
        relevance_tags,
        actionability,
        owner,
        priority,
        created_by,
        approval_status,
        registry_channel,
        content='facts',
        content_rowid='rowid'
      );

      CREATE TRIGGER facts_ai AFTER INSERT ON facts BEGIN
        INSERT INTO facts_fts(
          rowid, namespace, key, value, description, fact_type, subject, scope,
          status, derivation, source, evidence, time_period, audience,
          relevance_tags, actionability, owner, priority, created_by, approval_status, registry_channel
        )
        VALUES (
          new.rowid, new.namespace, new.key, new.value, new.description,
          new.fact_type, new.subject, new.scope, new.status, new.derivation,
          new.source, new.evidence, new.time_period, new.audience,
          new.relevance_tags, new.actionability, new.owner, new.priority,
          new.created_by, new.approval_status, new.registry_channel
        );
      END;

      CREATE TRIGGER facts_ad AFTER DELETE ON facts BEGIN
        INSERT INTO facts_fts(
          facts_fts, rowid, namespace, key, value, description, fact_type,
          subject, scope, status, derivation, source, evidence, time_period,
          audience, relevance_tags, actionability, owner, priority, created_by,
          approval_status, registry_channel
        )
        VALUES(
          'delete', old.rowid, old.namespace, old.key, old.value,
          old.description, old.fact_type, old.subject, old.scope, old.status,
          old.derivation, old.source, old.evidence, old.time_period,
          old.audience, old.relevance_tags, old.actionability, old.owner,
          old.priority, old.created_by, old.approval_status, old.registry_channel
        );
      END;

      CREATE TRIGGER facts_au AFTER UPDATE ON facts BEGIN
        INSERT INTO facts_fts(
          facts_fts, rowid, namespace, key, value, description, fact_type,
          subject, scope, status, derivation, source, evidence, time_period,
          audience, relevance_tags, actionability, owner, priority, created_by,
          approval_status, registry_channel
        )
        VALUES(
          'delete', old.rowid, old.namespace, old.key, old.value,
          old.description, old.fact_type, old.subject, old.scope, old.status,
          old.derivation, old.source, old.evidence, old.time_period,
          old.audience, old.relevance_tags, old.actionability, old.owner,
          old.priority, old.created_by, old.approval_status, old.registry_channel
        );
        INSERT INTO facts_fts(
          rowid, namespace, key, value, description, fact_type, subject, scope,
          status, derivation, source, evidence, time_period, audience,
          relevance_tags, actionability, owner, priority, created_by, approval_status, registry_channel
        )
        VALUES (
          new.rowid, new.namespace, new.key, new.value, new.description,
          new.fact_type, new.subject, new.scope, new.status, new.derivation,
          new.source, new.evidence, new.time_period, new.audience,
          new.relevance_tags, new.actionability, new.owner, new.priority,
          new.created_by, new.approval_status, new.registry_channel
        );
      END;
    `);

    db.exec("INSERT INTO facts_fts(facts_fts) VALUES('rebuild')");
} catch (err) {
    console.error('Failed to initialize FTS5. Ensure this SQLite build supports FTS5.', err);
}

export interface FactRow {
    rowid: number;
    namespace: string;
    key: string;
    value: string;
    description: string | null;
    fact_type: string;
    subject: string | null;
    scope: string | null;
    status: string;
    derivation: string;
    confidence: number | null;
    source: string | null;
    evidence: string | null;
    valid_from: number | null;
    valid_until: number | null;
    observed_at: number | null;
    time_period: string | null;
    audience: string | null;
    relevance_tags: string | null;
    actionability: string;
    owner: string | null;
    priority: string;
    related_facts: string | null;
    created_by: string | null;
    approved_by: string | null;
    approval_status: string;
    registry_channel: string;
    version: number;
    published_at: number | null;
    published_by: string | null;
    change_reason: string | null;
    supersedes: string | null;
    superseded_by: string | null;
    created_at: number;
    updated_at: number;
}

export interface AuditLogRow {
    id: number;
    action: string;
    namespace: string;
    key: string;
    old_value: string | null;
    new_value: string | null;
    old_snapshot: string | null;
    new_snapshot: string | null;
    timestamp: number;
}

export interface AgentProfileRow {
    id: string;
    name: string;
    description: string | null;
    role: string;
    allowed_fact_types: string;
    writable_fact_types: string;
    relevant_scopes: string;
    relevant_subjects: string;
    intents: string;
    audience_tags: string;
    can_propose_facts: number;
    can_approve_facts: number;
    allowed_actions: string;
    requires_human_approval_for: string;
    created_at: number;
    updated_at: number;
}
export interface FactVersionRow {
    id: number;
    namespace: string;
    key: string;
    version: number;
    event: string;
    registry_channel: string;
    snapshot: string;
    author: string | null;
    change_reason: string | null;
    created_at: number;
}
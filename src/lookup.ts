import { randomUUID } from 'crypto';
import { db } from './db.js';
import type { FactResponse } from './model.js';
import { getRegistry, normalizeRegistryName, assertCanLookupNamespace } from './registry.js';
import { namespaceChain, parentNamespaces } from './namespaces.js';
import {
    factFromRow,
    getFactRow,
    listFactNamespaces,
    listFacts,
    searchFacts
} from './store.js';

export type LookupOptions = {
    /** When false, skip parent namespaces and explicit lookups (default true). */
    lookup?: boolean;
};

export type LookupSource = 'local' | 'parent' | 'lookup';

export interface NamespaceLookupRecord {
    id: string;
    registry_name: string;
    from_namespace: string;
    target_registry: string;
    target_namespace: string;
    created_at: number;
    updated_at: number;
}

export type LookupTarget = {
    registry: string;
    namespace: string;
};

export { namespaceChain, parentNamespaces };

/** Parse `ns` or `Registry/ns`. */
export function parseLookupTarget(
    raw: string,
    defaultRegistry: string
): LookupTarget {
    const text = raw.trim().replace(/^\/+|\/+$/g, '');
    if (!text) throw new Error('Lookup target is required');
    const slash = text.indexOf('/');
    if (slash === -1) {
        return { registry: defaultRegistry, namespace: text };
    }
    const registry = normalizeRegistryName(text.slice(0, slash));
    const namespace = text.slice(slash + 1).trim();
    if (!namespace) throw new Error(`Invalid lookup target '${raw}' (use namespace or Registry/namespace)`);
    return { registry, namespace };
}

function annotateFact(fact: FactResponse, source: LookupSource): FactResponse {
    return {
        ...fact,
        lookup_source: source,
        writable: source === 'local'
    };
}

function factId(namespace: string, key: string): string {
    return `${namespace}\0${key}`;
}

export async function ensureNamespaceLookupsTable(): Promise<void> {
    await db.run(`
      CREATE TABLE IF NOT EXISTS namespace_lookups (
        id TEXT PRIMARY KEY,
        registry_name TEXT NOT NULL,
        from_namespace TEXT NOT NULL,
        target_registry TEXT NOT NULL,
        target_namespace TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(registry_name, from_namespace, target_registry, target_namespace)
      )
    `);
}

function rowToLookup(row: {
    id: string;
    registry_name: string;
    from_namespace: string;
    target_registry: string;
    target_namespace: string;
    created_at: number;
    updated_at: number;
}): NamespaceLookupRecord {
    return {
        id: row.id,
        registry_name: row.registry_name,
        from_namespace: row.from_namespace,
        target_registry: row.target_registry,
        target_namespace: row.target_namespace,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

export async function listNamespaceLookups(
    registryName: string,
    fromNamespace?: string
): Promise<NamespaceLookupRecord[]> {
    await ensureNamespaceLookupsTable();
    const registry = normalizeRegistryName(registryName);
    if (fromNamespace?.trim()) {
        const rows = await db.all<{
            id: string;
            registry_name: string;
            from_namespace: string;
            target_registry: string;
            target_namespace: string;
            created_at: number;
            updated_at: number;
        }>(
            `
          SELECT * FROM namespace_lookups
          WHERE lower(registry_name) = lower(?) AND from_namespace = ?
          ORDER BY from_namespace, target_registry, target_namespace
        `,
            [registry, fromNamespace.trim()]
        );
        return rows.map(rowToLookup);
    }
    const rows = await db.all<{
        id: string;
        registry_name: string;
        from_namespace: string;
        target_registry: string;
        target_namespace: string;
        created_at: number;
        updated_at: number;
    }>(
        `
      SELECT * FROM namespace_lookups
      WHERE lower(registry_name) = lower(?)
      ORDER BY from_namespace, target_registry, target_namespace
    `,
        [registry]
    );
    return rows.map(rowToLookup);
}

/**
 * Explicit lookups that apply when resolving `namespace`:
 * registrations on the exact namespace and on its parent namespaces.
 */
export async function listApplicableLookups(
    registryName: string,
    namespace: string
): Promise<NamespaceLookupRecord[]> {
    const chain = namespaceChain(namespace);
    const all = await listNamespaceLookups(registryName);
    const byFrom = new Map(chain.map((ns) => [ns, [] as NamespaceLookupRecord[]]));
    for (const row of all) {
        const bucket = byFrom.get(row.from_namespace);
        if (bucket) bucket.push(row);
    }
    const out: NamespaceLookupRecord[] = [];
    for (const ns of chain) {
        out.push(...(byFrom.get(ns) || []));
    }
    return out;
}

export async function addNamespaceLookup(input: {
    registry: string;
    from_namespace: string;
    target: string;
    /** Person registering the lookup (for private target membership check). */
    person?: string | null;
}): Promise<NamespaceLookupRecord> {
    await ensureNamespaceLookupsTable();
    const registry = normalizeRegistryName(input.registry);
    const from = input.from_namespace.trim();
    if (!from) throw new Error('from_namespace is required');

    const target = parseLookupTarget(input.target, registry);
    if (!(await getRegistry(target.registry))) {
        throw new Error(`Target registry '${target.registry}' not found`);
    }
    if (
        target.registry.toLowerCase() === registry.toLowerCase() &&
        target.namespace === from
    ) {
        throw new Error('Lookup target cannot be the same namespace');
    }

    // Cross-registry: target namespace must be org-public (whole registry or that
    // namespace), or the person must be a member of the target registry.
    if (target.registry.toLowerCase() !== registry.toLowerCase()) {
        await assertCanLookupNamespace(input.person, target.registry, target.namespace);
    }

    const existing = await db.get<{ id: string }>(
        `
      SELECT id FROM namespace_lookups
      WHERE lower(registry_name) = lower(?)
        AND from_namespace = ?
        AND lower(target_registry) = lower(?)
        AND target_namespace = ?
    `,
        [registry, from, target.registry, target.namespace]
    );
    if (existing) {
        const row = await db.get<NamespaceLookupRecord>(
            'SELECT * FROM namespace_lookups WHERE id = ?',
            [existing.id]
        );
        return rowToLookup(row!);
    }

    const now = Date.now();
    const id = randomUUID();
    await db.run(
        `
      INSERT INTO namespace_lookups
        (id, registry_name, from_namespace, target_registry, target_namespace, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
        [id, registry, from, target.registry, target.namespace, now, now]
    );
    const created = await db.get<NamespaceLookupRecord>(
        'SELECT * FROM namespace_lookups WHERE id = ?',
        [id]
    );
    return rowToLookup(created!);
}

export async function removeNamespaceLookup(input: {
    registry: string;
    from_namespace: string;
    target: string;
}): Promise<boolean> {
    await ensureNamespaceLookupsTable();
    const registry = normalizeRegistryName(input.registry);
    const from = input.from_namespace.trim();
    const target = parseLookupTarget(input.target, registry);
    const result = await db.run(
        `
      DELETE FROM namespace_lookups
      WHERE lower(registry_name) = lower(?)
        AND from_namespace = ?
        AND lower(target_registry) = lower(?)
        AND target_namespace = ?
    `,
        [registry, from, target.registry, target.namespace]
    );
    return (result.changes ?? 0) > 0;
}

/** True if targetRegistry is only reachable as an explicit lookup (not membership). */
export async function isExplicitLookupTargetRegistry(
    fromRegistry: string,
    targetRegistry: string
): Promise<boolean> {
    const rows = await listNamespaceLookups(fromRegistry);
    const want = normalizeRegistryName(targetRegistry).toLowerCase();
    return rows.some((r) => r.target_registry.toLowerCase() === want);
}

type Annotated = { fact: FactResponse; source: LookupSource };

async function resolveOne(
    homeRegistry: string,
    namespace: string,
    key: string,
    options: LookupOptions
): Promise<Annotated | undefined> {
    // 1) Exact local namespace
    const local = await getFactRow(homeRegistry, namespace, key);
    if (local) {
        return { fact: annotateFact(factFromRow(local), 'local'), source: 'local' };
    }

    if (options.lookup === false) return undefined;

    // 2) Implicit parent namespaces (same registry)
    for (const parentNs of parentNamespaces(namespace)) {
        const row = await getFactRow(homeRegistry, parentNs, key);
        if (!row) continue;
        if (row.registry_channel !== 'published') continue;
        return { fact: annotateFact(factFromRow(row), 'parent'), source: 'parent' };
    }

    // 3) Explicit lookups (read-only published)
    const lookups = await listApplicableLookups(homeRegistry, namespace);
    for (const entry of lookups) {
        const row = await getFactRow(entry.target_registry, entry.target_namespace, key);
        if (!row || row.registry_channel !== 'published') continue;
        return {
            fact: annotateFact(factFromRow(row), 'lookup'),
            source: 'lookup'
        };
    }

    return undefined;
}

/**
 * Resolve one fact: local namespace → parent namespaces → explicit lookups.
 */
export async function getFactWithLookup(
    homeRegistry: string,
    namespace: string,
    key: string,
    options: LookupOptions = {}
): Promise<FactResponse | undefined> {
    const hit = await resolveOne(homeRegistry, namespace, key, options);
    return hit?.fact;
}

/**
 * List facts visible from a namespace: local + parent published + lookup published.
 * Local keys win.
 */
export async function listFactsWithLookup(
    homeRegistry: string,
    namespace: string,
    options: LookupOptions = {}
): Promise<FactResponse[]> {
    const byKey = new Map<string, FactResponse>();

    // Local namespace (all channels)
    for (const row of await listFacts(homeRegistry, namespace)) {
        byKey.set(factId(row.namespace, row.key), annotateFact(factFromRow(row), 'local'));
    }

    if (options.lookup !== false) {
        for (const parentNs of parentNamespaces(namespace)) {
            for (const row of await listFacts(homeRegistry, parentNs)) {
                if (row.registry_channel !== 'published') continue;
                const id = factId(row.namespace, row.key);
                if (byKey.has(id)) continue;
                byKey.set(id, annotateFact(factFromRow(row), 'parent'));
            }
        }

        for (const entry of await listApplicableLookups(homeRegistry, namespace)) {
            for (const row of await listFacts(entry.target_registry, entry.target_namespace)) {
                if (row.registry_channel !== 'published') continue;
                const id = factId(row.namespace, row.key);
                if (byKey.has(id)) continue;
                byKey.set(id, annotateFact(factFromRow(row), 'lookup'));
            }
        }
    }

    return [...byKey.values()].sort((a, b) => {
        const ns = a.namespace.localeCompare(b.namespace);
        return ns !== 0 ? ns : a.key.localeCompare(b.key);
    });
}

/**
 * Search: home registry FTS, then enrich with parent/lookup published matches for same keys? 
 * Simpler: search home registry; also search each explicit lookup target registry for query.
 */
export async function searchFactsWithLookup(
    homeRegistry: string,
    query: string,
    options: LookupOptions = {}
): Promise<FactResponse[]> {
    const byKey = new Map<string, FactResponse>();

    for (const row of await searchFacts(homeRegistry, query)) {
        byKey.set(factId(row.namespace, row.key), annotateFact(factFromRow(row), 'local'));
    }

    if (options.lookup !== false) {
        const lookups = await listNamespaceLookups(homeRegistry);
        const seenTargets = new Set<string>();
        for (const entry of lookups) {
            const t = `${entry.target_registry}\0${entry.target_namespace}`;
            if (seenTargets.has(t)) continue;
            seenTargets.add(t);
            for (const row of await searchFacts(entry.target_registry, query)) {
                if (row.namespace !== entry.target_namespace) continue;
                if (row.registry_channel !== 'published') continue;
                const id = factId(row.namespace, row.key);
                if (byKey.has(id)) continue;
                byKey.set(id, annotateFact(factFromRow(row), 'lookup'));
            }
        }
    }

    return [...byKey.values()].sort((a, b) => {
        const ns = a.namespace.localeCompare(b.namespace);
        return ns !== 0 ? ns : a.key.localeCompare(b.key);
    });
}

export async function listNamespacesWithLookup(
    homeRegistry: string,
    options: LookupOptions = {}
): Promise<string[]> {
    const set = new Set(await listFactNamespaces(homeRegistry));
    if (options.lookup !== false) {
        for (const entry of await listNamespaceLookups(homeRegistry)) {
            set.add(entry.from_namespace);
            set.add(entry.target_namespace);
        }
    }
    return [...set].sort();
}

/** Describe resolution path for CLI (no DB reads of facts). */
export async function describeLookupResolution(
    homeRegistry: string,
    namespace?: string
): Promise<{
    registry: string;
    parent_note: string;
    namespace_chain: string[];
    explicit_lookups: NamespaceLookupRecord[];
}> {
    const ns = namespace?.trim();
    return {
        registry: homeRegistry,
        parent_note:
            'Parent namespaces are implicit from the dotted hierarchy (no registration).',
        namespace_chain: ns ? namespaceChain(ns) : [],
        explicit_lookups: ns
            ? await listApplicableLookups(homeRegistry, ns)
            : await listNamespaceLookups(homeRegistry)
    };
}

export { annotateFact as annotateLookupFact };

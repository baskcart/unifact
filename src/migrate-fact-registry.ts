/**
 * Partition facts by org: UNIQUE(registry_name, namespace, key).
 * Called from SQLite/Postgres schema init (raw drivers).
 */

export function pickDefaultRegistryName(lookup: {
    singleApiKeyRegistry: string | null;
    activeRegistryFact: string | null;
    firstRegistry: string | null;
}): string {
    if (lookup.singleApiKeyRegistry) return lookup.singleApiKeyRegistry;
    if (lookup.activeRegistryFact) return lookup.activeRegistryFact.trim();
    if (lookup.firstRegistry) return lookup.firstRegistry;
    return 'local';
}

/** Resolve default org for backfilling legacy unscoped facts (SQLite). */
export function resolveDefaultRegistryNameSqlite(sqlite: {
    prepare: (sql: string) => { get: (...params: unknown[]) => unknown; all: (...params: unknown[]) => unknown[] };
}): string {
    const keyRegs = sqlite
        .prepare(
            `SELECT DISTINCT registry_name AS name FROM api_keys WHERE registry_name IS NOT NULL AND trim(registry_name) != ''`
        )
        .all() as Array<{ name: string }>;
    const singleApiKeyRegistry = keyRegs.length === 1 ? keyRegs[0].name : null;

    const active = sqlite
        .prepare(
            `SELECT value FROM facts WHERE namespace = 'company.infrastructure' AND key = 'active-registry' LIMIT 1`
        )
        .get() as { value?: string } | undefined;

    const first = sqlite
        .prepare(`SELECT name FROM registries ORDER BY created_at ASC LIMIT 1`)
        .get() as { name?: string } | undefined;

    return pickDefaultRegistryName({
        singleApiKeyRegistry,
        activeRegistryFact: active?.value ?? null,
        firstRegistry: first?.name ?? null
    });
}

export function factsTableHasOrgUnique(createSql: string | null | undefined): boolean {
    if (!createSql) return false;
    return /UNIQUE\s*\(\s*registry_name\s*,\s*namespace\s*,\s*key\s*\)/i.test(createSql);
}

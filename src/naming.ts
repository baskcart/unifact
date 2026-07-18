import { db } from './db.js';

/**
 * Top-level name token for collision checks.
 * baskcart.sales.policy → baskcart
 */
export function topLevelName(namespaceOrRegistry: string): string {
    const raw = namespaceOrRegistry.trim();
    if (!raw) return '';
    return raw.split('.')[0]?.trim() || raw;
}

function namesEqual(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function normalizeName(name: string): string {
    const cleaned = name.trim().replace(/^\/+|\/+$/g, '');
    if (!cleaned) throw new Error('Name is required');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(cleaned)) {
        throw new Error('Name must be 1–64 chars: letters, numbers, . _ -');
    }
    return cleaned;
}

/** True if any fact uses this exact namespace or a child under it (case-insensitive). */
export async function namespaceTreeExists(name: string): Promise<boolean> {
    const token = name.trim();
    if (!token) return false;
    const row = await db.get<{ n: number }>(
        `
      SELECT COUNT(*) AS n FROM facts
      WHERE lower(namespace) = lower(?)
         OR lower(namespace) LIKE lower(?) || '.%'
    `,
        [token, token]
    );
    return (row?.n ?? 0) > 0;
}

async function findRegistryByName(name: string): Promise<{ name: string } | undefined> {
    return db.get<{ name: string }>(
        'SELECT name FROM registries WHERE lower(name) = lower(?)',
        [name.trim()]
    );
}

async function listRegistryNames(): Promise<string[]> {
    const rows = await db.all<{ name: string }>('SELECT name FROM registries ORDER BY name ASC');
    return rows.map((r) => r.name);
}

/**
 * Registry names and namespace names share one identity space.
 * Creating registry R fails if namespace R or R.* already exists.
 */
export async function assertRegistryNameAvailable(name: string): Promise<void> {
    const registryName = normalizeName(name);
    const existing = await findRegistryByName(registryName);
    if (existing) {
        throw new Error(`Registry '${existing.name}' already exists`);
    }
    if (await namespaceTreeExists(registryName)) {
        throw new Error(
            `Cannot create registry '${registryName}': a namespace '${registryName}' (or '${registryName}.*') already exists. ` +
                `Registry and namespace names share one identity space — use a different registry name, or keep it as a namespace under the current registry.`
        );
    }
}

/**
 * Creating a new namespace N fails if a registry claims N or N's top-level segment.
 */
export async function assertNamespaceNameAvailable(namespace: string): Promise<void> {
    const ns = namespace.trim();
    if (!ns) throw new Error('namespace is required');

    const registries = await listRegistryNames();
    const top = topLevelName(ns);

    for (const registryName of registries) {
        if (namesEqual(registryName, ns)) {
            throw new Error(
                `Cannot use namespace '${ns}': registry '${registryName}' already exists. ` +
                    `Registry and namespace names share one identity space — put facts in that registry with a non-colliding namespace.`
            );
        }
        if (top && namesEqual(registryName, top)) {
            throw new Error(
                `Cannot use namespace '${ns}': top-level '${top}' is already registry '${registryName}'. ` +
                    `Join/focus that registry and use a namespace that does not reuse a registry name as its first segment ` +
                    `(example: registry Baskcart + namespace sales.policy — not namespace baskcart.sales).`
            );
        }
    }
}

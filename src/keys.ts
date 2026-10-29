import { randomBytes, randomUUID } from 'crypto';
import { db, type ApiKeyRow } from './db.js';
import { generateIdentityKey, hashApiKey, isKeyHash, secretMatchesStored } from './keyMaterial.js';
import { parseStringList, serializeStringListOrEmpty } from './model.js';

export interface ApiKeyRecord {
    id: string;
    person: string;
    /** Stored form: the secret on SQLite, `sha256:` + hex on the Postgres origin. */
    api_key: string;
    enabled: boolean;
    namespaces: string[];
    scopes: Array<'read' | 'write'>;
    registry_name: string | null;
    public_key: string | null;
    /** Set on SQLite. Null on the origin. */
    private_key: string | null;
    created_at: number;
    updated_at: number;
}

export interface CreateApiKeyInput {
    person: string;
    namespaces?: string[];
    scopes?: Array<'read' | 'write'>;
    /** If set, use this key value instead of generating one (e.g. mirror local→origin). */
    api_key?: string;
    /** Ed25519 public key from the client. The origin stores this and not the private key. */
    public_key?: string | null;
    enabled?: boolean;
    registry_name?: string | null;
    /** Local CLI only: explicitly replace a temporary local secret with an origin-issued secret. */
    replace_existing_secret?: boolean;
}

function rowToRecord(row: ApiKeyRow): ApiKeyRecord {
    const scopes = parseStringList(row.scopes).filter(
        (scope): scope is 'read' | 'write' => scope === 'read' || scope === 'write'
    );
    return {
        id: row.id,
        person: row.person,
        api_key: row.api_key,
        enabled: row.enabled === 1,
        namespaces: parseStringList(row.namespaces),
        scopes: scopes.length > 0 ? scopes : ['read', 'write'],
        registry_name: row.registry_name ?? null,
        public_key: row.public_key ?? null,
        private_key: row.private_key ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

function namespaceAllowed(allowed: string[], namespace: string): boolean {
    return allowed.some(pattern => {
        if (pattern === '*') return true;
        if (pattern.endsWith('.*')) {
            const prefix = pattern.slice(0, -2);
            return namespace === prefix || namespace.startsWith(`${prefix}.`);
        }
        return namespace === pattern;
    });
}

/** Whether this API key may access a namespace (empty/missing patterns → allow all). */
export function apiKeyAllowsNamespace(key: ApiKeyRecord | undefined, namespace: string): boolean {
    if (!key) return true;
    if (!key.namespaces.length) return true;
    return namespaceAllowed(key.namespaces, namespace);
}

export async function countApiKeys(): Promise<number> {
    const row = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM api_keys');
    return row?.n ?? 0;
}

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
    const rows = await db.all<ApiKeyRow>('SELECT * FROM api_keys ORDER BY person ASC');
    return rows.map(rowToRecord);
}

export async function getApiKeyByPerson(person: string): Promise<ApiKeyRecord | undefined> {
    const row = await db.get<ApiKeyRow>('SELECT * FROM api_keys WHERE person = ?', [person]);
    return row ? rowToRecord(row) : undefined;
}

/** Secret the client can send. Null when this database only kept the hash. */
export function recoverableSecret(key: { api_key: string }): string | null {
    return isKeyHash(key.api_key) ? null : key.api_key;
}

/** API view. Omits the private key and does not present a hash as if it were the secret. */
export function apiKeyView(key: ApiKeyRecord) {
    return {
        id: key.id,
        person: key.person,
        enabled: key.enabled,
        namespaces: key.namespaces,
        scopes: key.scopes,
        registry_name: key.registry_name,
        public_key: key.public_key,
        api_key: recoverableSecret(key) ?? undefined,
        created_at: key.created_at,
        updated_at: key.updated_at
    };
}

export async function findApiKeyBySecret(apiKey: string | undefined): Promise<ApiKeyRecord | undefined> {
    if (!apiKey) return undefined;
    const hashed = hashApiKey(apiKey);
    const row = await db.get<ApiKeyRow>(
        'SELECT * FROM api_keys WHERE (api_key = ? OR api_key = ?) AND enabled = 1',
        [hashed, apiKey]
    );
    if (!row || !secretMatchesStored(row.api_key, apiKey)) return undefined;
    return rowToRecord(row);
}

export async function getActiveLocalApiKey(): Promise<ApiKeyRecord | undefined> {
    const row = await db.get<ApiKeyRow>(
        'SELECT * FROM api_keys WHERE enabled = 1 ORDER BY updated_at DESC LIMIT 1'
    );
    return row ? rowToRecord(row) : undefined;
}

/** Switch CLI identity to this person. Creates a local key if none exists yet. */
export async function usePerson(person: string): Promise<ApiKeyRecord> {
    const name = person.trim();
    if (!name) throw new Error('person is required');

    let existing = await getApiKeyByPerson(name);
    if (!existing) {
        // Claim a local identity (name ≈ user id, generated key ≈ password).
        // Origin sync still happens on uni init / uni approve — not here.
        existing = await createApiKey({ person: name, namespaces: ['*'], enabled: true });
    }
    if (!existing.enabled) {
        throw new Error(
            `Person '${name}' is suspended (access OFF). Owner: uni approve <Registry> ${name}`
        );
    }
    const now = Date.now();
    await db.run('UPDATE api_keys SET updated_at = ? WHERE person = ?', [now, name]);
    const updated = await getApiKeyByPerson(name);
    if (!updated) throw new Error(`Failed to switch to '${name}'`);
    return updated;
}

export async function createApiKey(input: CreateApiKeyInput): Promise<ApiKeyRecord> {
    const person = input.person.trim();
    if (!person) {
        throw new Error('person is required');
    }

    const existing = await getApiKeyByPerson(person);
    const incoming = input.api_key?.trim() || '';
    if (
        existing &&
        incoming &&
        !secretMatchesStored(existing.api_key, incoming) &&
        input.replace_existing_secret !== true
    ) {
        throw new Error(
            `Person '${person}' already has a different key on this host. ` +
                `Use the local CLI's explicit key import, or use a new person name.`
        );
    }
    const namespaces = input.namespaces?.length
        ? input.namespaces
        : existing?.namespaces?.length
          ? existing.namespaces
          : ['*'];
    const scopes = input.scopes?.length
        ? input.scopes
        : existing?.scopes?.length
          ? existing.scopes
          : (['read', 'write'] as Array<'read' | 'write'>);
    const enabled = input.enabled === false ? 0 : 1;
    const registryName = input.registry_name?.trim() || null;
    const now = Date.now();

    // Keep the existing secret on update unless an explicit api_key is provided
    // (re-approve must widen namespaces without breaking the member's local key).
    const origin = db.backend === 'postgres';
    let plain = incoming;
    if (!plain) {
        if (existing && !isKeyHash(existing.api_key)) plain = existing.api_key;
        else if (!existing) {
            plain = `uf_${person.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24)}_${randomBytes(12).toString('hex')}`;
        }
    }
    const storedKey = plain ? (origin ? hashApiKey(plain) : plain) : existing!.api_key;
    let publicKey = input.public_key?.trim() || existing?.public_key || null;
    let privateKey: string | null = origin ? null : (existing?.private_key ?? null);
    if (!origin && !privateKey) {
        const identity = generateIdentityKey();
        privateKey = identity.privateKey;
        publicKey = publicKey || identity.publicKey;
    }

    if (existing) {
        await db.run(
            `UPDATE api_keys
             SET api_key = ?, enabled = ?, namespaces = ?, scopes = ?, registry_name = ?, public_key = ?, private_key = ?, updated_at = ?
             WHERE person = ?`,
            [
                storedKey,
                enabled,
                serializeStringListOrEmpty(namespaces, 'namespaces'),
                serializeStringListOrEmpty(scopes, 'scopes'),
                registryName ?? existing.registry_name,
                publicKey,
                privateKey,
                now,
                person
            ]
        );
        const updated = await getApiKeyByPerson(person);
        if (!updated) throw new Error('Failed to update API key');
        return updated;
    }

    const id = randomUUID();
    await db.run(
        `INSERT INTO api_keys (id, person, api_key, enabled, namespaces, scopes, registry_name, public_key, private_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            person,
            storedKey,
            enabled,
            serializeStringListOrEmpty(namespaces, 'namespaces'),
            serializeStringListOrEmpty(scopes, 'scopes'),
            registryName,
            publicKey,
            privateKey,
            now,
            now
        ]
    );

    const created = await getApiKeyByPerson(person);
    if (!created) throw new Error('Failed to create API key');
    return created;
}

export async function setApiKeyEnabled(person: string, enabled: boolean): Promise<ApiKeyRecord> {
    const existing = await getApiKeyByPerson(person);
    if (!existing) {
        throw new Error(`No API key for person '${person}'`);
    }
    const now = Date.now();
    await db.run('UPDATE api_keys SET enabled = ?, updated_at = ? WHERE person = ?', [
        enabled ? 1 : 0,
        now,
        person
    ]);
    const updated = await getApiKeyByPerson(person);
    if (!updated) throw new Error('Failed to update API key');
    return updated;
}

export async function keyHasAccess(
    apiKey: string | undefined,
    namespace: string | undefined,
    requiredScope: 'read' | 'write'
): Promise<boolean> {
    const record = await findApiKeyBySecret(apiKey);
    if (!record) return false;
    if (!record.scopes.includes(requiredScope)) return false;
    if (!namespace) return true;
    return namespaceAllowed(record.namespaces, namespace);
}

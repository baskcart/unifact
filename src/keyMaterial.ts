import {
    createHash,
    createPrivateKey,
    createPublicKey,
    generateKeyPairSync,
    sign,
    timingSafeEqual,
    verify
} from 'crypto';

export const KEY_HASH_PREFIX = 'sha256:';
export const SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

export function isKeyHash(value: string): boolean {
    return value.startsWith(KEY_HASH_PREFIX) && value.length === KEY_HASH_PREFIX.length + 64;
}

export function hashApiKey(secret: string): string {
    return KEY_HASH_PREFIX + createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** High-entropy person keys use SHA-256. The stored form is `sha256:` plus 64 hex chars. The hash itself is not a usable secret. */
export function secretMatchesStored(stored: string, presented: string): boolean {
    if (isKeyHash(stored)) {
        if (isKeyHash(presented)) return false;
        const actual = Buffer.from(stored);
        const expected = Buffer.from(hashApiKey(presented));
        if (actual.length !== expected.length) return false;
        return timingSafeEqual(actual, expected);
    }
    return stored === presented;
}

export function canonicalRequest(method: string, path: string, body: string, timestamp: string): string {
    const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
    return `${timestamp}\n${method.toUpperCase()}\n${path}\n${bodyHash}`;
}

export function generateIdentityKey(): { publicKey: string; privateKey: string } {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return {
        publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
        privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')
    };
}

export function signRequest(
    privateKeyB64: string,
    method: string,
    path: string,
    body: string,
    timestamp: string
): string {
    const key = createPrivateKey({
        key: Buffer.from(privateKeyB64, 'base64'),
        format: 'der',
        type: 'pkcs8'
    });
    return sign(null, Buffer.from(canonicalRequest(method, path, body, timestamp)), key).toString('base64');
}

export function verifyRequest(
    publicKeyB64: string,
    method: string,
    path: string,
    body: string,
    timestamp: string,
    signatureB64: string
): boolean {
    try {
        const key = createPublicKey({
            key: Buffer.from(publicKeyB64, 'base64'),
            format: 'der',
            type: 'spki'
        });
        return verify(
            null,
            Buffer.from(canonicalRequest(method, path, body, timestamp)),
            key,
            Buffer.from(signatureB64, 'base64')
        );
    } catch {
        return false;
    }
}

export function signatureTimestampOk(timestamp: string, now = Date.now()): boolean {
    const value = Number(timestamp);
    if (!Number.isFinite(value)) return false;
    return Math.abs(now - value) <= SIGNATURE_WINDOW_MS;
}

export function requestPath(url: string): string {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
}

export function requestAuthHeaders(input: {
    secret: string;
    privateKey?: string | null;
    method: string;
    url: string;
    body?: string;
}): Record<string, string> {
    const headers: Record<string, string> = {
        'X-API-Key': input.secret,
        Accept: 'application/json'
    };
    if (input.body !== undefined) headers['Content-Type'] = 'application/json';
    if (!input.privateKey) return headers;
    const timestamp = String(Date.now());
    headers['X-UniFact-Timestamp'] = timestamp;
    headers['X-UniFact-Signature'] = signRequest(
        input.privateKey,
        input.method,
        requestPath(input.url),
        input.body ?? '',
        timestamp
    );
    return headers;
}

export function checkRequestSignature(input: {
    publicKey: string | null;
    method: string;
    path: string;
    body: string;
    timestamp: string | undefined;
    signature: string | undefined;
    now?: number;
}): { ok: true } | { ok: false; error: string } {
    if (!input.publicKey) return { ok: true };
    if (!input.timestamp || !input.signature) {
        return { ok: false, error: 'Unauthorized: Signature required' };
    }
    if (!signatureTimestampOk(input.timestamp, input.now)) {
        return { ok: false, error: 'Unauthorized: Signature timestamp is outside the allowed window' };
    }
    if (
        !verifyRequest(
            input.publicKey,
            input.method,
            input.path,
            input.body,
            input.timestamp,
            input.signature
        )
    ) {
        return { ok: false, error: 'Unauthorized: Invalid signature' };
    }
    return { ok: true };
}

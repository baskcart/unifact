import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    checkRequestSignature,
    generateIdentityKey,
    hashApiKey,
    isKeyHash,
    requestAuthHeaders,
    secretMatchesStored,
    signRequest,
    verifyRequest
} from './keyMaterial.js';

describe('person key material', () => {
    it('matches a presented secret to its sha256 form and to a legacy plaintext row', () => {
        const secret = 'uf_admin_abc123';
        const hashed = hashApiKey(secret);
        assert.equal(isKeyHash(hashed), true);
        assert.equal(secretMatchesStored(hashed, secret), true);
        assert.equal(secretMatchesStored(secret, secret), true);
        assert.equal(secretMatchesStored(hashed, hashed), false);
        assert.equal(secretMatchesStored(hashed, 'uf_admin_other'), false);
    });

    it('accepts a signature from the local private key and rejects a bad one', () => {
        const { publicKey, privateKey } = generateIdentityKey();
        const timestamp = String(Date.now());
        const signature = signRequest(privateKey, 'PUT', '/v1/registries/Unifact/facts/company.infrastructure/upstream-registry-url', '{}', timestamp);
        assert.equal(
            verifyRequest(publicKey, 'PUT', '/v1/registries/Unifact/facts/company.infrastructure/upstream-registry-url', '{}', timestamp, signature),
            true
        );
        const missing = checkRequestSignature({
            publicKey,
            method: 'PUT',
            path: '/v1/x',
            body: '',
            timestamp: undefined,
            signature: undefined
        });
        assert.equal(missing.ok, false);
        const bad = checkRequestSignature({
            publicKey,
            method: 'PUT',
            path: '/v1/x',
            body: '',
            timestamp,
            signature: signRequest(privateKey, 'GET', '/v1/x', '', timestamp)
        });
        assert.equal(bad.ok, false);
        const stale = checkRequestSignature({
            publicKey,
            method: 'PUT',
            path: '/v1/x',
            body: '',
            timestamp: String(Date.now() - 10 * 60 * 1000),
            signature
        });
        assert.equal(stale.ok, false);
    });

    it('puts the public signature on outbound headers and leaves the private key out', () => {
        const { privateKey } = generateIdentityKey();
        const headers = requestAuthHeaders({
            secret: 'uf_cursorAgent_secret',
            privateKey,
            method: 'POST',
            url: 'https://origin.unifact.ai/v1/keys',
            body: JSON.stringify({ person: 'ada', public_key: 'abc' })
        });
        assert.equal(headers['X-API-Key'], 'uf_cursorAgent_secret');
        assert.equal(typeof headers['X-UniFact-Signature'], 'string');
        assert.equal(JSON.stringify(headers).includes(privateKey), false);
        assert.equal(JSON.stringify({ person: 'ada', public_key: 'abc' }).includes('private'), false);
    });
});

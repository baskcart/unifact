import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(join(tmpdir(), 'unifact-onboarding-'));
const databasePath = join(tempRoot, 'store.db');
const cli = join(repoRoot, 'dist', 'cli.js');
const api = join(repoRoot, 'dist', 'api.js');

const port = await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const selected = typeof address === 'object' && address ? address.port : 0;
        server.close(() => resolvePort(selected));
    });
});

const env = { ...process.env, DATABASE_PATH: databasePath, PORT: String(port) };
const initialized = spawnSync(process.execPath, [cli, 'init', 'Unifact', '--person', 'admin'], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
    windowsHide: true
});
assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

const database = new Database(databasePath);
const ownerKey = database.prepare('SELECT api_key FROM api_keys WHERE person = ?').get('admin').api_key;
database.close();

const child = spawn(process.execPath, [api], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
});

async function waitForApi() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/healthz`);
            if (response.ok) return;
        } catch {
            // Startup is still in progress.
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error('Timed out waiting for onboarding API');
}

async function requestJoinHttp(person, candidate) {
    return fetch(`http://127.0.0.1:${port}/v1/registries/Unifact/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person, candidate_api_key: candidate })
    });
}

async function approve(person, apiKey) {
    return fetch(`http://127.0.0.1:${port}/v1/registries/Unifact/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify({ person })
    });
}

try {
    await waitForApi();
    const claudeKey = 'uf_claudeDesktop_candidate_device_key';
    const otherKey = 'uf_otherAgent_candidate_device_key';
    assert.equal((await requestJoinHttp('claudeDesktop', claudeKey)).status, 200);
    assert.equal((await requestJoinHttp('otherAgent', otherKey)).status, 200);

    let check = new Database(databasePath, { readonly: true });
    assert.equal(check.prepare('SELECT enabled FROM api_keys WHERE person = ?').get('claudeDesktop').enabled, 0);
    check.close();

    assert.equal((await approve('claudeDesktop', ownerKey)).status, 200);
    assert.equal((await approve('otherAgent', claudeKey)).status, 403);
    assert.equal((await approve('otherAgent', ownerKey)).status, 200);

    check = new Database(databasePath, { readonly: true });
    const approved = check.prepare('SELECT api_key, enabled FROM api_keys WHERE person = ?').get('claudeDesktop');
    check.close();
    assert.deepEqual(approved, { api_key: claudeKey, enabled: 1 });
    console.log(JSON.stringify({ ok: true, publicPendingJoin: true, sameDeviceKeyApproved: true, ownerOnlyApproval: true }));
} finally {
    child.kill();
    await new Promise((resolveWait) => child.once('exit', resolveWait));
    await rm(tempRoot, { recursive: true, force: true });
}

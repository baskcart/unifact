import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(join(tmpdir(), 'unifact-key-import-'));
const databasePath = join(tempRoot, 'store.db');
const env = { ...process.env, DATABASE_PATH: databasePath };
const cli = join(repoRoot, 'dist', 'cli.js');

function run(args) {
    const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: repoRoot,
        env,
        encoding: 'utf8',
        windowsHide: true
    });
    assert.equal(result.status, 0, `${args.join(' ')} failed:\n${result.stderr}\n${result.stdout}`);
}

try {
    run(['use', 'claudeDesktop']);
    const originKey = 'uf_claudeDesktop_origin_approved_key';
    run(['key', 'create', '--person', 'claudeDesktop', '--api-key', originKey]);

    const database = new Database(databasePath, { readonly: true, fileMustExist: true });
    const key = database.prepare('SELECT person, api_key FROM api_keys WHERE person = ?').get('claudeDesktop');
    database.close();
    assert.deepEqual(key, { person: 'claudeDesktop', api_key: originKey });
    console.log(JSON.stringify({ ok: true, explicitLocalKeyImport: true }));
} finally {
    await rm(tempRoot, { recursive: true, force: true });
}

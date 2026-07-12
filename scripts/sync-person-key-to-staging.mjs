/**
 * One-time ops helper: copy local person API key secret onto staging Postgres.
 * Does NOT print the secret. Direct DB only (not via API).
 *
 * Usage:
 *   node scripts/sync-person-key-to-staging.mjs [person]
 */
import { spawnSync } from 'child_process';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const person = (process.argv[2] || 'admin').trim();
const keyPath =
    process.env.UNIFACT_SSH_KEY || path.join(path.dirname(root), 'LightsailDefaultKey-us-east-1.pem');
const host = process.env.UNIFACT_SSH_HOST || 'staging.unifact.ai';
const user = process.env.UNIFACT_SSH_USER || 'admin';
const appDir = process.env.UNIFACT_APP_DIR || '/var/www/unifact';
const remoteScript = path.join(__dirname, 'remote-update-person-key.mjs');

const localDb = new Database(path.join(root, 'store.db'));
const row = localDb
    .prepare(
        `SELECT api_key, enabled, namespaces, scopes, registry_name FROM api_keys WHERE person = ?`
    )
    .get(person);
localDb.close();

if (!row?.api_key) {
    console.error(`No local api_keys row for person='${person}'`);
    process.exit(1);
}

const payload = JSON.stringify({
    person,
    api_key: row.api_key,
    enabled: row.enabled,
    namespaces: row.namespaces,
    scopes: row.scopes,
    registry_name: row.registry_name || 'Unifact'
});

const sshBase = ['-i', keyPath, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes'];

const scp = spawnSync(
    'scp',
    [...sshBase, remoteScript, `${user}@${host}:${appDir}/scripts/remote-update-person-key.mjs`],
    { encoding: 'utf8' }
);
if (scp.status !== 0) {
    process.stderr.write(scp.stderr || scp.stdout || 'scp failed\n');
    process.exit(scp.status ?? 1);
}

const ssh = spawnSync(
    'ssh',
    [...sshBase, `${user}@${host}`, `cd ${appDir} && node scripts/remote-update-person-key.mjs`],
    { input: payload + '\n', encoding: 'utf8' }
);
if (ssh.stdout) process.stdout.write(ssh.stdout);
if (ssh.stderr) process.stderr.write(ssh.stderr);
process.exit(ssh.status ?? 1);

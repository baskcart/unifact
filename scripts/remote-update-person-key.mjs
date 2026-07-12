/**
 * Staging-side helper: update one person key from JSON on stdin.
 * Invoked by sync-person-key-to-staging.mjs — do not call with secrets on the CLI.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: path.join(process.cwd(), '.env') });

// Staging managed Postgres often presents a chain local trust store rejects.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const raw = fs.readFileSync(0, 'utf8').trim();
const body = JSON.parse(raw);
const url = process.env.DATABASE_URL;
if (!url) {
    console.error('DATABASE_URL missing on staging');
    process.exit(1);
}

const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false }
});

await client.connect();
try {
    const existing = await client.query('SELECT person, registry_name FROM api_keys WHERE person = $1', [
        body.person
    ]);
    const now = Date.now();
    if (existing.rows.length === 0) {
        await client.query(
            `INSERT INTO api_keys (id, person, api_key, enabled, namespaces, scopes, registry_name, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
            [
                randomUUID(),
                body.person,
                body.api_key,
                body.enabled ? 1 : 0,
                body.namespaces,
                body.scopes,
                body.registry_name,
                now
            ]
        );
        console.log(`inserted person=${body.person} registry=${body.registry_name}`);
    } else {
        await client.query(
            `UPDATE api_keys
             SET api_key = $1, enabled = $2, namespaces = $3, scopes = $4,
                 registry_name = COALESCE($5, registry_name), updated_at = $6
             WHERE person = $7`,
            [
                body.api_key,
                body.enabled ? 1 : 0,
                body.namespaces,
                body.scopes,
                body.registry_name,
                now,
                body.person
            ]
        );
        console.log(
            `updated person=${body.person} registry=${body.registry_name || existing.rows[0].registry_name}`
        );
    }
} finally {
    await client.end();
}

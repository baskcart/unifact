import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    assertReleaseCheckout,
    CODE_GRAPHS_DDL,
    ensureCodeGraphs,
    normalizeRepo,
    writerUrlFromEnv
} from './code-graphs.js';

const clean = {
    branch: 'main',
    porcelain: '',
    head: 'abc1234',
    releaseRef: 'main'
};

describe('code graph release gate', () => {
    it('accepts a clean checkout of the release branch', () => {
        assert.doesNotThrow(() => assertReleaseCheckout(clean));
    });

    it('rejects a dirty tree', () => {
        assert.throws(
            () => assertReleaseCheckout({ ...clean, porcelain: ' M src/api.ts' }),
            /clean tree/
        );
    });

    it('rejects a different branch', () => {
        assert.throws(
            () => assertReleaseCheckout({ ...clean, branch: 'feature' }),
            /HEAD is feature/
        );
    });

    it('rejects a detached checkout', () => {
        assert.throws(() => assertReleaseCheckout({ ...clean, branch: 'HEAD' }), /requires branch main/);
    });
});

describe('code graph writer login', () => {
    it('requires a writer URL that is not the API login', () => {
        assert.throws(() => writerUrlFromEnv({}), /CODE_GRAPHS_DATABASE_URL/);
        assert.throws(
            () =>
                writerUrlFromEnv({
                    DATABASE_URL: 'postgresql://api@db/unifact',
                    CODE_GRAPHS_DATABASE_URL: 'postgresql://api@db/unifact'
                }),
            /must not be the API database login/
        );
        assert.equal(
            writerUrlFromEnv({
                DATABASE_URL: 'postgresql://api@db/unifact',
                CODE_GRAPHS_DATABASE_URL: 'postgresql://writer@db/unifact'
            }),
            'postgresql://writer@db/unifact'
        );
    });
});

describe('code graph schema', () => {
    it('uses a temporal primary key', () => {
        assert.match(CODE_GRAPHS_DDL, /btree_gist/);
        assert.match(CODE_GRAPHS_DDL, /WITHOUT OVERLAPS/);
        assert.match(CODE_GRAPHS_DDL, /code_graphs/);
    });

    it('normalizes a git remote to the repo URL', () => {
        assert.equal(normalizeRepo('git@github.com:baskcart/unifact.git'), 'https://github.com/baskcart/unifact');
    });

    it('skips creation when the table is already present', async () => {
        const calls: string[] = [];
        const result = await ensureCodeGraphs(async (sql) => {
            calls.push(sql);
            if (sql.includes('pg_extension')) return { rows: [{ ok: true }] };
            return { rows: [{ name: 'code_graphs' }] };
        });
        assert.equal(result, 'ready');
        assert.equal(calls.some((sql) => sql.includes('CREATE TABLE')), false);
    });

    it('creates the table when it is missing', async () => {
        const calls: string[] = [];
        const result = await ensureCodeGraphs(async (sql) => {
            calls.push(sql);
            if (sql.includes('pg_extension')) return { rows: [{ ok: false }] };
            if (sql.includes('to_regclass')) return { rows: [{ name: null }] };
            return { rows: [] };
        });
        assert.equal(result, 'created');
        assert.equal(calls.some((sql) => sql.includes('WITHOUT OVERLAPS')), true);
    });
});

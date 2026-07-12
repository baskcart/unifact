#!/usr/bin/env node
import 'dotenv/config';
import { getMetadataFromGitUrl } from './git-metadata.js';
import {
    createApiKey,
    listApiKeys,
    setApiKeyEnabled
} from './keys.js';
import { getSyncConfig, getRemoteBranchUrl } from './sync.js';
import { getSyncStatus, pullFactsFromRemote, pushFactsToRemote } from './store.js';

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
    switch (command) {
        case 'status':
            await statusCommand();
            break;
        case 'pull':
            await pullCommand(args);
            break;
        case 'push':
            await pushCommand(args);
            break;
        case 'key':
            await keyCommand(args);
            break;
        case 'meta':
            await metaCommand(args);
            break;
        default:
            printHelp();
            process.exit(1);
    }
}

function printHelp() {
    console.log('uni — UniFact local ↔ origin sync');
    console.log('');
    console.log('Usage: uni <command>');
    console.log('');
    console.log('Commands:');
    console.log('  status');
    console.log('  pull [namespaces…]');
    console.log('  push [namespaces…]');
    console.log('  key create --person <name> [--namespaces a,b] [--remote]');
    console.log('  key list');
    console.log('  key on --person <name>');
    console.log('  key off --person <name>');
    console.log('  meta <git-url>     Fetch org/repo metadata from a Git URL (no git clone)');
    console.log('');
    console.log('API keys live in the UniFact api_keys table (one per person, on/off).');
    console.log('No master key and no API key env vars.');
}

function parseFlag(argv: string[], name: string): string | undefined {
    const idx = argv.indexOf(name);
    if (idx === -1) return undefined;
    return argv[idx + 1];
}

function hasFlag(argv: string[], name: string): boolean {
    return argv.includes(name);
}

async function statusCommand() {
    try {
        const status = await getSyncStatus();
        const sync = await getSyncConfig();
        console.log('Upstream status:');
        console.log(`  Enabled: ${status.enabled}`);
        console.log(`  Upstream URL: ${status.upstreamUrl || 'Not configured'}`);
        console.log(`  Person: ${sync.person || 'none (create a key)'}`);
        console.log(`  Local Facts: ${status.localFacts}`);
        console.log(`  Review Queue: ${status.reviewQueue}`);
        if (!status.enabled) {
            console.log('');
            console.log('Need: company.infrastructure/upstream-registry-url + an enabled api_keys row');
            console.log('  uni key create --person you --remote');
        }
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function pullCommand(namespaces: string[]) {
    try {
        console.log('Pulling published facts from origin...');
        const result = await pullFactsFromRemote(namespaces.length > 0 ? namespaces : undefined);
        console.log(`Pull complete: pulled=${result.pulled} skipped=${result.skipped} conflicts=${result.conflicts}`);
        for (const fact of result.facts) {
            console.log(`  - ${fact.namespace}/${fact.key}`);
        }
    } catch (error) {
        console.error('Pull failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function pushCommand(namespaces: string[]) {
    try {
        console.log('Pushing proposed facts to origin...');
        const result = await pushFactsToRemote(namespaces.length > 0 ? namespaces : undefined);
        console.log(`Push complete: pushed=${result.pushed} failed=${result.failed}`);
        for (const fact of result.facts) {
            console.log(`  - ${fact.namespace}/${fact.key}`);
        }
    } catch (error) {
        console.error('Push failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function keyCommand(argv: string[]) {
    const sub = argv[0];
    try {
        if (sub === 'list') {
            const keys = await listApiKeys();
            if (keys.length === 0) {
                console.log('No API keys yet. Create one: uni key create --person you');
                return;
            }
            for (const key of keys) {
                console.log(
                    `${key.enabled ? 'ON ' : 'OFF'}  ${key.person}  ${key.api_key}  ns=${key.namespaces.join(',')}`
                );
            }
            return;
        }

        if (sub === 'on' || sub === 'off') {
            const person = parseFlag(argv, '--person');
            if (!person) {
                console.error(`Usage: uni key ${sub} --person <name>`);
                process.exit(1);
            }
            const key = await setApiKeyEnabled(person, sub === 'on');
            console.log(`${key.person}: ${key.enabled ? 'ON' : 'OFF'} (${key.api_key})`);
            return;
        }

        if (sub === 'create') {
            const person = parseFlag(argv, '--person');
            if (!person) {
                console.error('Usage: uni key create --person <name> [--namespaces a,b] [--remote]');
                process.exit(1);
            }
            const namespacesArg = parseFlag(argv, '--namespaces');
            const namespaces = namespacesArg
                ? namespacesArg.split(',').map(s => s.trim()).filter(Boolean)
                : ['*'];
            const remote = hasFlag(argv, '--remote');

            let key = await listApiKeys().then(keys => keys.find(k => k.person === person));
            if (!key) {
                key = await createApiKey({ person, namespaces });
                console.log(`Local key for ${key.person}: ${key.api_key} (${key.enabled ? 'ON' : 'OFF'})`);
            } else {
                console.log(`Using existing local key for ${key.person}: ${key.api_key} (${key.enabled ? 'ON' : 'OFF'})`);
            }

            if (remote) {
                const upstream = await getRemoteBranchUrl();
                if (!upstream) {
                    console.error('No upstream URL (set company.infrastructure/upstream-registry-url)');
                    process.exit(1);
                }
                const payload = {
                    person: key.person,
                    api_key: key.api_key,
                    namespaces: key.namespaces,
                    scopes: key.scopes
                };
                let response = await fetch(`${upstream}/v1/keys`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!response.ok && (response.status === 401 || response.status === 403)) {
                    response = await fetch(`${upstream}/v1/keys`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-API-Key': key.api_key
                        },
                        body: JSON.stringify(payload)
                    });
                }
                if (!response.ok) {
                    const text = await response.text();
                    console.error(`Remote key create failed: ${response.status} ${text}`);
                    process.exit(1);
                }
                console.log(`Also registered on origin ${upstream}`);
            }
            return;
        }

        console.log('Usage: uni key create|list|on|off …');
        process.exit(1);
    } catch (error) {
        console.error('Key command failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function metaCommand(argv: string[]) {
    const url = argv[0];
    if (!url) {
        console.error('Usage: uni meta <git-url>');
        console.error('Example: uni meta https://github.com/baskcart/unifact');
        process.exit(1);
    }
    try {
        const meta = await getMetadataFromGitUrl(url);
        console.log('Git URL metadata (via hosting API — no git clone):');
        console.log(`  Source:   ${meta.source}`);
        console.log(`  Org:      ${meta.org ?? '(unknown)'}`);
        console.log(`  Repo:     ${meta.repo ?? '(unknown)'}`);
        console.log(`  Name:     ${meta.name ?? '(unknown)'}`);
        console.log(`  URL:      ${meta.url}`);
        console.log(`  Branch:   ${meta.default_branch ?? '(unknown)'}`);
        console.log(`  Private:  ${meta.private === null ? '(unknown)' : meta.private}`);
        console.log(`  Home:     ${meta.homepage ?? '(none)'}`);
        console.log(`  About:    ${meta.description ?? '(none)'}`);
        console.log('');
        console.log('Suggested registry org name:', meta.org || meta.name || '(set manually)');
    } catch (error) {
        console.error('Meta lookup failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

main().catch(error => {
    console.error('CLI error:', error);
    process.exit(1);
});

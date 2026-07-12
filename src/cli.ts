#!/usr/bin/env node
import 'dotenv/config';
import { getMetadataFromGitUrl } from './git-metadata.js';
import {
    createApiKey,
    getActiveLocalApiKey,
    listApiKeys,
    setApiKeyEnabled
} from './keys.js';
import {
    approveJoin,
    initRegistry,
    listJoinRequests,
    listRegistries,
    parseJoinTarget,
    requestJoin
} from './registry.js';
import { getSyncConfig, getRemoteBranchUrl } from './sync.js';
import { getSyncStatus, pullFactsFromRemote, pushFactsToRemote } from './store.js';

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
    switch (command) {
        case 'status':
            await statusCommand();
            break;
        case 'init':
            await initCommand(args);
            break;
        case 'join':
            await joinCommand(args);
            break;
        case 'approve':
            await approveCommand(args);
            break;
        case 'registries':
            await registriesCommand();
            break;
        case 'requests':
            await requestsCommand(args);
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
    console.log('uni — UniFact registries and sync');
    console.log('');
    console.log('Usage: uni <command>');
    console.log('');
    console.log('Registry (like git init / join a remote):');
    console.log('  init <Registry> --person <you> [--git-url <url>]');
    console.log('  join <Registry|host/Registry> --person <you>');
    console.log('  approve <Registry> --person <member> --by <owner>');
    console.log('  registries');
    console.log('  requests [Registry]');
    console.log('');
    console.log('Sync:');
    console.log('  status | pull | push');
    console.log('');
    console.log('Keys:');
    console.log('  key list | key on|off --person <name>');
    console.log('  meta <git-url>');
    console.log('');
    console.log('First person: uni init Unifact --person admin');
    console.log('Others:       uni join Unifact --person alice  (owner: uni approve …)');
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
        const registries = await listRegistries();
        console.log('Upstream status:');
        console.log(`  Enabled: ${status.enabled}`);
        console.log(`  Upstream URL: ${status.upstreamUrl || 'Not configured'}`);
        console.log(`  Person: ${sync.person || 'none'}`);
        console.log(`  Local Facts: ${status.localFacts}`);
        console.log(`  Review Queue: ${status.reviewQueue}`);
        console.log(`  Registries: ${registries.length ? registries.map(r => r.name).join(', ') : '(none — uni init <Name> --person you)'}`);
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function initCommand(argv: string[]) {
    const name = argv[0];
    const person = parseFlag(argv, '--person');
    const gitUrl = parseFlag(argv, '--git-url');
    if (!name || !person) {
        console.error('Usage: uni init <Registry> --person <you> [--git-url <url>]');
        process.exit(1);
    }
    try {
        const result = await initRegistry({ name, person, git_url: gitUrl });
        console.log(`Initialized registry '${result.registry.name}'`);
        console.log(`  Owner: ${result.registry.owner_person}`);
        console.log(`  Key:   ${result.key.api_key} (ON)`);
        if (result.registry.git_url) console.log(`  Git:   ${result.registry.git_url}`);
        console.log('You own this registry. Others: uni join ' + result.registry.name + ' --person <name>');
    } catch (error) {
        console.error('Init failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function joinCommand(argv: string[]) {
    const target = argv[0];
    const person = parseFlag(argv, '--person');
    if (!target || !person) {
        console.error('Usage: uni join <Registry|host/Registry> --person <you>');
        process.exit(1);
    }
    try {
        const { host, registry } = parseJoinTarget(target);
        if (host) {
            const upstream = `http://${host}`;
            const active = await getActiveLocalApiKey();
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (active?.api_key) headers['X-API-Key'] = active.api_key;
            let response = await fetch(`${upstream}/v1/registries/${encodeURIComponent(registry)}/join`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ person })
            });
            if (!response.ok && (response.status === 401 || response.status === 403)) {
                response = await fetch(`${upstream}/v1/registries/${encodeURIComponent(registry)}/join`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ person })
                });
            }
            if (!response.ok) {
                console.error(`Remote join failed: ${response.status} ${await response.text()}`);
                process.exit(1);
            }
            const body = (await response.json()) as { request: { status: string } };
            console.log(`Join request for '${registry}' on ${host}: ${body.request.status}`);
            console.log('Wait for the owner to: uni approve ' + registry + ' --person ' + person + ' --by <owner>');
            return;
        }

        const request = await requestJoin({ registry, person });
        console.log(`Join request for '${registry}': ${request.status}`);
        if (request.status === 'pending') {
            console.log('Owner must approve: uni approve ' + registry + ' --person ' + person + ' --by <owner>');
        }
    } catch (error) {
        console.error('Join failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function approveCommand(argv: string[]) {
    const registry = argv[0];
    const person = parseFlag(argv, '--person');
    const by = parseFlag(argv, '--by');
    if (!registry || !person || !by) {
        console.error('Usage: uni approve <Registry> --person <member> --by <owner>');
        process.exit(1);
    }
    try {
        const result = await approveJoin({
            registry,
            person,
            approved_by: by,
            pull: hasFlag(argv, '--pull')
        });
        console.log(`Approved '${person}' on registry '${registry}'`);
        console.log(`  Key: ${result.key.api_key} (ON)`);
        if (result.pull) {
            console.log(`  Pull: pulled=${result.pull.pulled} skipped=${result.pull.skipped}`);
        }
        console.log('Share the key with the member (or they pull after syncing keys).');
    } catch (error) {
        console.error('Approve failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function registriesCommand() {
    try {
        const registries = await listRegistries();
        if (registries.length === 0) {
            console.log('No registries. Create one: uni init Unifact --person you');
            return;
        }
        for (const r of registries) {
            console.log(`${r.name}  owner=${r.owner_person}${r.description ? `  — ${r.description}` : ''}`);
        }
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function requestsCommand(argv: string[]) {
    try {
        const registry = argv[0];
        const requests = await listJoinRequests(registry);
        if (requests.length === 0) {
            console.log('No join requests.');
            return;
        }
        for (const r of requests) {
            console.log(`${r.status.padEnd(8)}  ${r.registry_name}  ${r.person}`);
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

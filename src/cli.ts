#!/usr/bin/env node
import 'dotenv/config';
import { getMetadataFromGitUrl } from './git-metadata.js';
import {
    createApiKey,
    getActiveLocalApiKey,
    getApiKeyByPerson,
    listApiKeys,
    setApiKeyEnabled,
    usePerson
} from './keys.js';
import {
    approveJoin,
    assertPersonMemberOfRegistry,
    focusRegistry,
    getTeam,
    initRegistry,
    listRegistriesForPerson,
    parseJoinTarget,
    requestJoin,
    requireWorkingRegistry,
    resolveActiveRegistry,
    suspendJoin,
    type PersonRegistryMembership
} from './registry.js';
import { sanitizeFactKey, suggestFactKey } from './suggest-key.js';
import { getSyncConfig, getRemoteBranchUrl } from './sync.js';
import {
    feedbackFact,
    getFactRow,
    getPushCollaborationContext,
    getSyncStatus,
    listFactsByChannels,
    publishFact,
    pullFactsFromRemote,
    parsePushSelector,
    pushFactsToRemote,
    upsertFact
} from './store.js';

const command = process.argv[2];
const args = process.argv.slice(3);

async function main() {
    switch (command) {
        case 'status':
            await statusCommand();
            break;
        case 'add':
            await addCommand(args);
            break;
        case 'publish':
            await publishCommand(args);
            break;
        case 'feedback':
            await feedbackCommand(args);
            break;
        case 'commit':
            await commitCommand(args);
            break;
        case 'init':
            await initCommand(args);
            break;
        case 'whoami':
        case 'who':
            await whoamiCommand();
            break;
        case 'use':
            await useCommand(args);
            break;
        case 'join':
            await joinCommand(args);
            break;
        case 'approve':
            await approveCommand(args);
            break;
        case 'suspend':
            await suspendCommand(args);
            break;
        case 'registries':
            await registriesCommand();
            break;
        case 'team':
            await teamCommand(args);
            break;
        case 'facts':
            await factsCommand(args);
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
    console.log('Facts (local registry):');
    console.log('  add "<value>" [--key k] [--namespace policy] [--person you]');
    console.log('      → proposed (local agents can use it; production needs publish)');
    console.log('  publish <namespace/key> | publish --all [--person you]');
    console.log('      → published (solo: from proposed; multi-user: from review|feedback only)');
    console.log('  feedback <namespace/key> | feedback --all [--person you]');
    console.log('      → feedback (open for comments; not production)');
    console.log('  push [ns|ns/key|ns/pattern*]  — owner→feedback, others→review');
    console.log('');
    console.log('Identity (person name + key secret ≈ user id + password):');
    console.log('  whoami | who');
    console.log('  use <person>     # switch; creates local key if first time');
    console.log('');
    console.log('Registry (membership):');
    console.log('  init <Registry> [--person you]   # person from context if omitted');
    console.log('  join <Registry|host/Registry>    # join as you (context)');
    console.log('  approve <Registry> [member]      # you (owner) approve member');
    console.log('  suspend <Registry> <member>      # you (owner) pause member');
    console.log('  team [Registry]                  # your registries only');
    console.log('  facts [Registry]                 # list facts (prompt if many orgs)');
    console.log('  registries                       # registries you own or belong to');
    console.log('');
    console.log('Sync:');
    console.log('  status | pull | push [selectors…]');
    console.log('');
    console.log('Advanced (technical):');
    console.log('  key list | key create --person <name> [--namespaces a,b] [--api-key uf_…] [--remote]');
    console.log('  key on|off --person <name>   # low-level; prefer approve / suspend');
    console.log('  meta <git-url>');
    console.log('');
    console.log('First person: uni init Unifact --person admin');
    console.log('Others:       uni use alice && uni join host/Unifact');
    console.log('Owner:        uni use admin && uni approve Unifact alice');
    console.log('');
    console.log('Local fact loop:');
    console.log('  uni add "Returns are free within 30 days"');
    console.log('  uni publish policy/return_window');
    console.log('  uni push policy/return_window');
    console.log('  uni push policy/feeling_*');
}

function parseFlag(argv: string[], name: string): string | undefined {
    const idx = argv.indexOf(name);
    if (idx === -1) return undefined;
    return argv[idx + 1];
}

function hasFlag(argv: string[], name: string): boolean {
    return argv.includes(name);
}

const BOOLEAN_FLAGS = new Set(['--all', '--publish', '--pull']);

function positionalArgs(argv: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            if (!BOOLEAN_FLAGS.has(arg) && argv[i + 1] && !argv[i + 1].startsWith('--')) {
                i += 1;
            }
            continue;
        }
        out.push(arg);
    }
    return out;
}

function parseFactPath(path: string): { namespace: string; key: string } {
    const slash = path.indexOf('/');
    if (slash <= 0 || slash === path.length - 1) {
        throw new Error(`Fact path must look like namespace/key (got '${path}')`);
    }
    return {
        namespace: path.slice(0, slash),
        key: path.slice(slash + 1)
    };
}

async function resolvePerson(argv: string[]): Promise<string> {
    const flagged = parseFlag(argv, '--person');
    if (flagged) return flagged;
    const active = await getActiveLocalApiKey();
    if (active?.person) return active.person;
    return 'local';
}

/** Current CLI identity — must have an enabled person key. */
async function requireContextPerson(argv?: string[]): Promise<string> {
    const flagged = argv ? parseFlag(argv, '--person') : undefined;
    if (flagged) return flagged;
    const active = await getActiveLocalApiKey();
    if (active?.person) return active.person;
    throw new Error(
        'No active person. Create one (uni init … --person you) or switch: uni use <person>'
    );
}

/** Actor for owner actions (approve/suspend). Prefer --by override, else context. */
async function requireActor(argv: string[]): Promise<string> {
    const by = parseFlag(argv, '--by');
    if (by) return by;
    const active = await getActiveLocalApiKey();
    if (active?.person) return active.person;
    throw new Error(
        'No active person. Switch to the owner: uni use <owner>'
    );
}

/** Suspend / key-off blocks local CLI writes for that person (same as API auth). */
async function assertPersonAccess(person: string): Promise<void> {
    const key = await getApiKeyByPerson(person);
    if (key && !key.enabled) {
        throw new Error(
            `Person '${person}' is suspended (access OFF). Owner restores with: uni approve <Registry> ${person}`
        );
    }
}

/** Working org for fact CLI commands (active person → requireWorkingRegistry). */
async function resolveWorkingRegistry(person?: string): Promise<string> {
    const who = person ?? (await resolvePerson([]));
    return requireWorkingRegistry(who);
}

async function whoamiCommand() {
    try {
        const active = await getActiveLocalApiKey();
        if (!active) {
            console.log('No active person. uni init <Registry> --person you');
            return;
        }
        const registry = await resolveActiveRegistry(active.person);
        console.log(`You are: ${active.person}`);
        console.log(`  Access: ${active.enabled ? 'on' : 'off'}`);
        console.log(`  Active registry: ${registry || '(none — uni init or uni join)'}`);
        if (registry) {
            try {
                const team = await getTeam(registry);
                const me = team.members.find((m) => m.person === active.person);
                const role =
                    me?.status === 'owner' || me?.role === 'owner'
                        ? 'owner'
                        : me?.status || 'member';
                console.log(`  Role: ${role}`);
            } catch {
                /* registry missing locally */
            }
        }
        console.log(`  Namespaces: ${active.namespaces.join(', ') || '(none)'}`);
        console.log('Switch: uni use <person>');
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function useCommand(argv: string[]) {
    const person = argv[0] || parseFlag(argv, '--person');
    if (!person) {
        console.error('Usage: uni use <person>');
        process.exit(1);
    }
    try {
        const key = await usePerson(person);
        if (key.registry_name) {
            await focusRegistry(key.registry_name);
        }
        const registry = await resolveActiveRegistry(key.person);
        console.log(`Now acting as: ${key.person}`);
        if (registry) console.log(`  Active registry: ${registry}`);
        console.log('(Auth = this person name + key secret. Role comes from org membership.)');
    } catch (error) {
        console.error('Use failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function statusCommand() {
    try {
        const status = await getSyncStatus();
        const sync = await getSyncConfig();
        const person = sync.person;
        if (!person) {
            console.log('No active person. uni use <person> or uni init <Registry>');
            return;
        }

        const mine = await listRegistriesForPerson(person);
        let activeReg = await resolveActiveRegistry(person);
        if (activeReg && !mine.some((m) => m.registry.name === activeReg)) {
            // Don't show an active registry the person does not belong to.
            activeReg = mine[0]?.registry.name ?? null;
        }
        if (!activeReg && mine.length === 1) {
            activeReg = mine[0].registry.name;
        }

        console.log('Identity:');
        console.log(`  Person: ${person}`);
        console.log(`  Active registry: ${activeReg || '(none)'}`);
        console.log('');

        console.log('Your registries:');
        if (mine.length === 0) {
            console.log('  (none — uni init <Registry> or uni join <Registry>)');
        } else {
            for (const row of mine) {
                const mark = row.registry.name === activeReg ? '*' : ' ';
                let teamCount = '';
                try {
                    const team = await getTeam(row.registry.name);
                    teamCount = `  team=${team.members.length}`;
                } catch {
                    /* ignore */
                }
                console.log(
                    ` ${mark} ${row.registry.name}  role=${row.role}  status=${row.status}${teamCount}`
                );
            }
            console.log('  (* = active; uni use <person> focuses their org)');
        }

        if (activeReg) {
            console.log('');
            console.log(`Active: ${activeReg}`);
            try {
                const team = await getTeam(activeReg);
                const me = team.members.find((m) => m.person === person);
                const role =
                    me?.status === 'owner' || me?.role === 'owner'
                        ? 'owner'
                        : me?.status || 'unknown';
                console.log(`  Your role: ${role}`);
                console.log(`  Owner: ${team.owner}`);
                console.log('  Members:');
                for (const m of team.members) {
                    const label = m.status === 'owner' ? 'owner' : m.status;
                    console.log(`    ${label.padEnd(10)} ${m.access.padEnd(4)}  ${m.person}`);
                }
                console.log(`  uni team ${activeReg}`);
            } catch (error) {
                console.log(
                    `  (could not load team: ${error instanceof Error ? error.message : String(error)})`
                );
            }
        }

        console.log('');
        console.log('Upstream:');
        console.log(`  Enabled: ${status.enabled}`);
        console.log(`  Upstream URL: ${status.upstreamUrl || 'Not configured'}`);
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

/**
 * uni add "<value>" — local proposed fact (visible to local agents).
 */
async function addCommand(argv: string[]) {
    try {
        const valueParts = positionalArgs(argv);
        const value = valueParts.join(' ').trim();
        if (!value) {
            console.error('Usage: uni add "<value>" [--key k] [--namespace policy] [--person you]');
            process.exit(1);
        }

        const namespaceFlag = parseFlag(argv, '--namespace') || 'policy';
        const keyFlag = parseFlag(argv, '--key');
        const person = await resolvePerson(argv);
        await assertPersonAccess(person);
        const registry = await resolveWorkingRegistry(person);

        const suggested = suggestFactKey(value, namespaceFlag);
        let key = keyFlag ? sanitizeFactKey(keyFlag) : suggested.key;
        if (!key) key = `fact_${Date.now().toString(36)}`;

        const existing = await getFactRow(registry, namespaceFlag, key);
        if (existing && !keyFlag) {
            key = sanitizeFactKey(`${key}_v2`) || `${key}_2`;
        }

        const result = await upsertFact(registry, namespaceFlag, key, {
            value,
            description: 'Added via uni add',
            fact_type: 'entity_fact',
            derivation: 'asserted',
            source: 'uni-cli',
            created_by: person,
            approval_status: 'pending',
            registry_channel: 'proposed',
            actionability: 'informational',
            priority: 'normal',
            change_reason: 'uni add',
            _event: 'propose'
        });

        const fact = result.fact;
        console.log(`Added ${fact.namespace}/${fact.key}`);
        console.log(`  channel: ${fact.registry_channel}`);
        console.log(`  value:   ${fact.value}`);
        if (!keyFlag) {
            console.log(`  key:     suggested (override with --key)`);
        }
        console.log('');
        console.log('Local agents can use this. Production needs:');
        console.log(`  uni publish ${fact.namespace}/${fact.key}`);
        console.log(`  uni feedback ${fact.namespace}/${fact.key}   # or open for comments`);
    } catch (error) {
        console.error('Add failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function resolveFactTargets(
    argv: string[],
    channels: string[],
    registryName: string
): Promise<Array<{ namespace: string; key: string }>> {
    const all = hasFlag(argv, '--all');
    const paths = positionalArgs(argv);
    if (all) {
        const facts = await listFactsByChannels(registryName, channels);
        return facts.map((f) => ({ namespace: f.namespace, key: f.key }));
    }
    if (paths.length === 0) {
        throw new Error('Provide <namespace/key> or --all');
    }
    return paths.map(parseFactPath);
}

/** Channels uni publish may promote (solo can publish proposed directly). */
async function publishSourceChannels(): Promise<string[]> {
    const person = await resolvePerson([]);
    const ctx = await getPushCollaborationContext(person);
    if (ctx.solo) {
        return ['proposed', 'review', 'feedback', 'working'];
    }
    // Multi-user: two-step — only review/feedback → published
    return ['review', 'feedback'];
}

/** uni publish <path>|--all — owner marks production truth. */
async function publishCommand(argv: string[]) {
    try {
        const person = await resolvePerson(argv);
        await assertPersonAccess(person);
        const registry = await resolveWorkingRegistry(person);
        const allowed = await publishSourceChannels();
        const targets = await resolveFactTargets(argv, allowed, registry);
        if (targets.length === 0) {
            console.log(
                `Nothing to publish (need channel: ${allowed.join(' | ')}).`
            );
            console.log('Multi-user: uni push first (→ feedback/review), then uni publish.');
            return;
        }
        const ctx = await getPushCollaborationContext(person);
        for (const { namespace, key } of targets) {
            const existing = await getFactRow(registry, namespace, key);
            if (!existing) {
                console.error(`Fact not found: ${namespace}/${key}`);
                process.exit(1);
            }
            if (!allowed.includes(existing.registry_channel)) {
                console.error(
                    `Cannot publish ${namespace}/${key} from channel '${existing.registry_channel}'.`
                );
                if (!ctx.solo) {
                    console.error(
                        'Multi-user: only review or feedback can be published. Push first, then publish.'
                    );
                } else {
                    console.error(`Allowed sources: ${allowed.join(', ')}`);
                }
                process.exit(1);
            }
            const result = await publishFact(registry, namespace, key, {
                published_by: person,
                approved_by: person,
                change_reason: 'uni publish'
            });
            console.log(`Published ${result.fact.namespace}/${result.fact.key}`);
        }
    } catch (error) {
        console.error('Publish failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

/** uni feedback <path>|--all — owner opens for comments (not production). */
async function feedbackCommand(argv: string[]) {
    try {
        const person = await resolvePerson(argv);
        await assertPersonAccess(person);
        const registry = await resolveWorkingRegistry(person);
        const all = hasFlag(argv, '--all');
        const paths = positionalArgs(argv);
        let targets: Array<{ namespace: string; key: string }> = [];
        if (all) {
            const facts = await listFactsByChannels(registry, [
                'proposed',
                'review',
                'feedback',
                'working'
            ]);
            targets = facts.map((f) => ({ namespace: f.namespace, key: f.key }));
        } else if (paths.length >= 1) {
            targets = paths.map(parseFactPath);
        } else {
            throw new Error('Provide <namespace/key> or --all');
        }
        if (targets.length === 0) {
            console.log('Nothing to open for feedback.');
            return;
        }
        for (const { namespace, key } of targets) {
            const existing = await getFactRow(registry, namespace, key);
            if (!existing) {
                console.error(`Fact not found: ${namespace}/${key}`);
                process.exit(1);
            }
            const result = await feedbackFact(registry, namespace, key, {
                published_by: person,
                approved_by: person,
                change_reason: 'uni feedback'
            });
            console.log(`Feedback ${result.fact.namespace}/${result.fact.key} (channel=feedback)`);
        }
    } catch (error) {
        console.error('Feedback failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

/**
 * Legacy commit — prefer uni publish / uni feedback.
 * commit --publish → publish; otherwise working → proposed.
 */
async function commitCommand(argv: string[]) {
    if (hasFlag(argv, '--publish')) {
        const next = argv.filter((a) => a !== '--publish');
        return publishCommand(next);
    }
    try {
        const person = await resolvePerson(argv);
        const registry = await resolveWorkingRegistry(person);
        const all = hasFlag(argv, '--all');
        const paths = positionalArgs(argv);
        let targets: Array<{ namespace: string; key: string }> = [];
        if (all) {
            const facts = await listFactsByChannels(registry, ['working']);
            targets = facts.map((f) => ({ namespace: f.namespace, key: f.key }));
            if (targets.length === 0) {
                console.log('No legacy working facts. Use: uni add "..." then uni publish …');
                return;
            }
        } else if (paths.length >= 1) {
            targets = paths.map(parseFactPath);
        } else {
            console.error('Usage: uni publish <namespace/key> | uni feedback <namespace/key>');
            console.error('(uni commit is legacy; uni commit --publish aliases publish)');
            process.exit(1);
        }

        for (const { namespace, key } of targets) {
            const existing = await getFactRow(registry, namespace, key);
            if (!existing) {
                console.error(`Fact not found: ${namespace}/${key}`);
                process.exit(1);
            }
            const result = await upsertFact(registry, namespace, key, {
                value: existing.value,
                description: existing.description,
                fact_type: existing.fact_type,
                derivation: existing.derivation,
                source: existing.source,
                created_by: existing.created_by,
                approval_status: 'pending',
                registry_channel: 'proposed',
                actionability: existing.actionability,
                priority: existing.priority,
                change_reason: 'uni commit',
                _event: 'propose'
            });
            console.log(`Committed ${result.fact.namespace}/${result.fact.key} → proposed (by ${person})`);
        }
    } catch (error) {
        console.error('Commit failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function initCommand(argv: string[]) {
    const name = argv[0];
    const gitUrl = parseFlag(argv, '--git-url');
    let person = parseFlag(argv, '--person');
    if (!name) {
        console.error('Usage: uni init <Registry> [--person you] [--git-url <url>]');
        process.exit(1);
    }
    if (!person) {
        try {
            person = await requireContextPerson();
        } catch {
            console.error('Usage: uni init <Registry> --person <you> [--git-url <url>]');
            console.error('(No active person yet — pass --person for the first init.)');
            process.exit(1);
        }
    }
    try {
        const result = await initRegistry({ name, person, git_url: gitUrl });
        console.log(`Initialized registry '${result.registry.name}'`);
        console.log(`  Owner: ${result.registry.owner_person}`);
        console.log(`  Key:   ${result.key.api_key} (ON)`);
        console.log(`  Namespaces: ${result.key.namespaces.join(', ')}`);
        if (result.registry.git_url) console.log(`  Git:   ${result.registry.git_url}`);
        if (result.remote?.pushed) {
            console.log('  Origin: org + owner key registered (local and remote match)');
        } else if (result.remote?.attempted) {
            console.log(
                `  Origin: not synced (${result.remote.status || ''} ${result.remote.detail || ''})`.trim()
            );
            console.log('  Deploy latest UniFact on origin for public org create, or fix person/key conflict.');
        } else if (result.remote?.detail) {
            console.log(`  Origin: skipped — ${result.remote.detail}`);
        }
        console.log('Auth: person name + key secret (like user id + password). Role: owner.');
        console.log(`Others: uni use <them> && uni join ${result.registry.name}`);
    } catch (error) {
        console.error('Init failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function joinCommand(argv: string[]) {
    const target = argv[0];
    if (!target) {
        console.error('Usage: uni join <Registry|host/Registry>');
        console.error('Joins as your active person (uni whoami / uni use <person>).');
        process.exit(1);
    }
    try {
        const person = await requireContextPerson(argv);
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
            console.log(`Join request for '${registry}' on ${host} as ${person}: ${body.request.status}`);
            console.log('Owner (on that host): uni approve ' + registry + ' ' + person);
            console.log('Then install the printed key: uni key create --person ' + person + ' --api-key <printed>');
            return;
        }

        const request = await requestJoin({ registry, person });
        console.log(`Join request for '${registry}' as ${person}: ${request.status}`);
        if (request.status === 'pending') {
            console.log('Owner: uni approve ' + registry + ' ' + person);
        }
    } catch (error) {
        console.error('Join failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function resolveApproveMember(registry: string, argv: string[]): Promise<string> {
    const flagged = parseFlag(argv, '--person');
    const positional = positionalArgs(argv).slice(1); // argv[0] is registry
    if (flagged) return flagged;
    if (positional[0]) return positional[0];

    const team = await getTeam(registry);
    const pending = team.members.filter((m) => m.status === 'pending');
    if (pending.length === 1) return pending[0].person;
    if (pending.length === 0) {
        throw new Error(`No pending join requests on '${registry}'. Usage: uni approve ${registry} <member>`);
    }
    throw new Error(
        `Multiple pending joins on '${registry}': ${pending.map((p) => p.person).join(', ')}. ` +
            `Usage: uni approve ${registry} <member>`
    );
}

async function approveCommand(argv: string[]) {
    const registry = argv[0];
    if (!registry) {
        console.error('Usage: uni approve <Registry> [member]');
        console.error('You (active person) must be the owner. Member from arg, or the only pending request.');
        process.exit(1);
    }
    try {
        const by = await requireActor(argv);
        const person = await resolveApproveMember(registry, argv);
        const result = await approveJoin({
            registry,
            person,
            approved_by: by,
            pull: hasFlag(argv, '--pull')
        });
        console.log(`Approved '${person}' on registry '${registry}' (by ${by})`);
        console.log(`  Key: ${result.key.api_key} (ON)`);
        console.log(`  Namespaces: ${result.key.namespaces.join(', ')}`);
        if (result.remote?.pushed) {
            console.log('  Origin: member key pushed (write access on upstream)');
        } else if (result.remote?.attempted) {
            console.log(
                `  Origin: key push failed (${result.remote.status || ''} ${result.remote.detail || ''})`.trim()
            );
        } else if (result.remote?.detail) {
            console.log(`  Origin: skipped — ${result.remote.detail}`);
        }
        if (result.pull) {
            console.log(`  Facts pull: pulled=${result.pull.pulled} skipped=${result.pull.skipped}`);
        }
        console.log('Keys are push-only (never pulled). Member can uni push with this same key.');
        console.log(`Pause later: uni suspend ${registry} ${person}`);
        await usePerson(by);
    } catch (error) {
        console.error('Approve failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function suspendCommand(argv: string[]) {
    const registry = argv[0];
    const flagged = parseFlag(argv, '--person');
    const positional = positionalArgs(argv).slice(1);
    const person = flagged || positional[0];
    if (!registry || !person) {
        console.error('Usage: uni suspend <Registry> <member>');
        console.error('You (active person) must be the owner.');
        process.exit(1);
    }
    try {
        const by = await requireActor(argv);
        const result = await suspendJoin({
            registry,
            person,
            suspended_by: by
        });
        console.log(`Suspended '${person}' on registry '${registry}' (by ${by})`);
        console.log(`  Membership: ${result.request.status}`);
        console.log(`  Access: OFF (person key disabled)`);
        if (result.remote?.pushed) {
            console.log('  Origin: member key turned OFF on upstream');
        } else if (result.remote?.attempted && !result.remote.pushed) {
            console.log(
                `  Origin: key push failed (${result.remote.status || ''} ${result.remote.detail || ''})`.trim()
            );
        }
        console.log(`Restore: uni approve ${registry} ${person}`);
        await usePerson(by);
    } catch (error) {
        console.error('Suspend failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function requireActivePerson(): Promise<string> {
    const active = await getActiveLocalApiKey();
    if (!active?.person) {
        throw new Error('No active person. uni use <person> or uni init <Registry>');
    }
    return active.person;
}

/** Memberships for the active person; empty list is ok (caller messages). */
async function myRegistries(): Promise<{ person: string; mine: PersonRegistryMembership[] }> {
    const person = await requireActivePerson();
    const mine = await listRegistriesForPerson(person);
    return { person, mine };
}

/**
 * Pick a registry the person belongs to.
 * - explicit arg → must be a membership
 * - one membership → that registry
 * - many → print prompt and return null
 * - none → throw
 */
async function resolveMemberRegistry(
    argv: string[],
    usage: string
): Promise<{ person: string; registry: string } | null> {
    const { person, mine } = await myRegistries();
    if (mine.length === 0) {
        throw new Error('No registries. Create one: uni init <Registry> — or join: uni join <Registry>');
    }

    const named = positionalArgs(argv)[0];
    if (named) {
        const membership = await assertPersonMemberOfRegistry(person, named);
        return { person, registry: membership.registry.name };
    }

    if (mine.length === 1) {
        return { person, registry: mine[0].registry.name };
    }

    console.log(`Usage: ${usage}`);
    console.log('Your registries:');
    for (const row of mine) {
        console.log(`  ${row.registry.name}  role=${row.role}`);
    }
    return null;
}

async function registriesCommand() {
    try {
        const { person, mine } = await myRegistries();
        if (mine.length === 0) {
            console.log(`No registries for '${person}'. Create one: uni init Unifact`);
            return;
        }
        for (const row of mine) {
            const r = row.registry;
            console.log(
                `${r.name}  role=${row.role}  owner=${r.owner_person}${r.description ? `  — ${r.description}` : ''}`
            );
        }
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function teamCommand(argv: string[]) {
    try {
        const picked = await resolveMemberRegistry(argv, 'uni team <Registry>');
        if (!picked) return;
        await printTeam(picked.registry);
    } catch (error) {
        console.error('Team failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function factsCommand(argv: string[]) {
    try {
        const picked = await resolveMemberRegistry(argv, 'uni facts <Registry>');
        if (!picked) return;

        const facts = await listFactsByChannels(picked.registry, [
            'proposed',
            'review',
            'feedback',
            'published',
            'working'
        ]);

        console.log(`Facts (local) — registry context: ${picked.registry}`);
        console.log(`  Person: ${picked.person}`);
        console.log('');

        if (facts.length === 0) {
            console.log('  (none — uni add "…")');
            return;
        }

        const awaiting = facts.filter((f) =>
            ['proposed', 'review', 'feedback', 'working'].includes(f.registry_channel)
        );
        const published = facts.filter((f) => f.registry_channel === 'published');

        if (awaiting.length > 0) {
            console.log('Needs attention (proposed / review / feedback):');
            for (const fact of awaiting) {
                console.log(
                    `  [${fact.registry_channel.padEnd(9)}] ${fact.namespace}/${fact.key}  ${truncateFactValue(fact.value)}`
                );
            }
            console.log('');
            console.log('  Publish:  uni publish <namespace/key>');
            console.log('  Feedback: uni feedback <namespace/key>');
            console.log('');
        }

        if (published.length > 0) {
            console.log('Published:');
            for (const fact of published) {
                console.log(
                    `  ${fact.namespace}/${fact.key}  ${truncateFactValue(fact.value)}`
                );
            }
        }

        if (awaiting.length === 0 && published.length === 0) {
            for (const fact of facts) {
                console.log(
                    `  [${fact.registry_channel}] ${fact.namespace}/${fact.key}  ${truncateFactValue(fact.value)}`
                );
            }
        }
    } catch (error) {
        console.error('Facts failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

function truncateFactValue(value: unknown, max = 72): string {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (!text) return '';
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

async function printTeam(registryName: string) {
    const team = await getTeam(registryName);
    console.log(`Team: ${team.registry}  (owner=${team.owner})`);
    console.log('');
    console.log('Status     Access  Person');
    for (const m of team.members) {
        const status = m.status === 'owner' ? 'owner' : m.status;
        console.log(`${status.padEnd(10)} ${m.access.padEnd(6)}  ${m.person}`);
    }
    const pending = team.members.filter((m) => m.status === 'pending');
    if (pending.length > 0) {
        console.log('');
        console.log('Pending join requests — approve with:');
        for (const p of pending) {
            console.log(`  uni use ${team.owner}`);
            console.log(`  uni approve ${team.registry} ${p.person}`);
        }
    }
}

async function pullCommand(namespaces: string[]) {
    try {
        const sync = await getSyncConfig();
        if (sync.person) await assertPersonAccess(sync.person);
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

async function pushCommand(selectors: string[]) {
    try {
        const sync = await getSyncConfig();
        if (sync.person) await assertPersonAccess(sync.person);
        for (const token of selectors) {
            parsePushSelector(token);
        }
        console.log(
            selectors.length > 0
                ? `Pushing to origin (selectors: ${selectors.join(', ')})...`
                : 'Pushing to origin (all local namespaces you can write)...'
        );
        const result = await pushFactsToRemote(selectors.length > 0 ? selectors : undefined);
        console.log(`Push complete: pushed=${result.pushed} failed=${result.failed}`);
        for (const fact of result.facts) {
            console.log(`  - [${fact.registry_channel}] ${fact.namespace}/${fact.key}`);
        }
        if (result.pushed === 0 && result.failed === 0) {
            console.log(
                'Nothing to push (no matching facts in allowed namespaces, or join/approve not done).'
            );
        }
        if (result.failed > 0) {
            console.log('');
            console.log('Hint: 403 usually means origin write scopes are missing.');
            console.log('  1) uni use <you> && uni join <host>/<Registry>');
            console.log('  2) owner: uni use <owner> && uni approve <Registry> <you>');
            console.log('  3) install the printed key locally, then retry uni push');
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
                console.error('Prefer: uni approve / uni suspend for membership access.');
                process.exit(1);
            }
            const key = await setApiKeyEnabled(person, sub === 'on');
            console.log(`${key.person}: ${key.enabled ? 'ON' : 'OFF'} (${key.api_key})`);
            console.log('(Advanced) Prefer uni approve / uni suspend to manage membership.');
            return;
        }

        if (sub === 'create') {
            const person = parseFlag(argv, '--person');
            if (!person) {
                console.error(
                    'Usage: uni key create --person <name> [--namespaces a,b] [--api-key uf_…] [--remote]'
                );
                process.exit(1);
            }
            const namespacesArg = parseFlag(argv, '--namespaces');
            const namespaces = namespacesArg
                ? namespacesArg.split(',').map((s) => s.trim()).filter(Boolean)
                : ['*'];
            const apiKeyArg = parseFlag(argv, '--api-key');
            const remote = hasFlag(argv, '--remote');

            let key = await listApiKeys().then((keys) => keys.find((k) => k.person === person));
            if (!key) {
                key = await createApiKey({ person, namespaces, api_key: apiKeyArg });
                console.log(`Local key for ${key.person}: ${key.api_key} (${key.enabled ? 'ON' : 'OFF'})`);
            } else if (apiKeyArg || namespacesArg) {
                key = await createApiKey({
                    person,
                    namespaces: namespacesArg ? namespaces : key.namespaces,
                    api_key: apiKeyArg || key.api_key
                });
                console.log(
                    `Updated local key for ${key.person}: ${key.api_key} ns=${key.namespaces.join(',')} (${key.enabled ? 'ON' : 'OFF'})`
                );
            } else {
                console.log(
                    `Using existing local key for ${key.person}: ${key.api_key} (${key.enabled ? 'ON' : 'OFF'})`
                );
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

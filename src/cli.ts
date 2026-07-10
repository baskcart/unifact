#!/usr/bin/env node
import 'dotenv/config';
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
        default:
            console.log('Unifact CLI - Upstream staging commands');
            console.log('');
            console.log('Usage: unifact <command> [options]');
            console.log('');
            console.log('Commands:');
            console.log('  status    Show upstream staging configuration and status');
            console.log('  pull      Pull published facts from upstream registry');
            console.log('  push      Push proposed facts to upstream staging for review');
            console.log('');
            console.log('Examples:');
            console.log('  unifact status');
            console.log('  unifact pull');
            console.log('  unifact pull company.decisions company.branding');
            console.log('  unifact push');
            console.log('  unifact push company.decisions');
            process.exit(1);
    }
}

async function statusCommand() {
    try {
        const status = getSyncStatus();
        console.log('Upstream Staging Status:');
        console.log(`  Enabled: ${status.enabled}`);
        console.log(`  Upstream URL: ${status.upstreamUrl || status.remoteUrl || 'Not configured'}`);
        console.log(`  Role: ${status.role}`);
        console.log(`  Local Facts: ${status.localFacts}`);
        console.log(`  Review Queue: ${status.reviewQueue}`);
        console.log(`  Last Sync: ${status.lastSync ? new Date(status.lastSync).toISOString() : 'Never'}`);
        const sourceLabel = status.source === 'fact'
            ? 'UniFact facts'
            : status.source === 'env' ? 'Environment variables' : 'Not configured';
        console.log(`  Config Source: ${sourceLabel}`);
        
        if (!status.enabled) {
            console.log('');
            console.log('To enable upstream staging, either:');
            console.log('');
            console.log('Option 1 - Set facts in UniFact:');
            console.log('  company.infrastructure/upstream-registry-url = https://staging.unifact.ai');
            console.log('  company.infrastructure/upstream-registry-role = staging');
            console.log('');
            console.log('Option 2 - Set environment variables:');
            console.log('  UNIFACT_UPSTREAM_REGISTRY_URL=https://staging.unifact.ai');
            console.log('  UNIFACT_API_KEY=your-api-key');
            console.log('  UNIFACT_UPSTREAM_REGISTRY_ROLE=staging (optional)');
        }
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function pullCommand(args: string[]) {
    try {
        const namespaces = args.length > 0 ? args : undefined;
        console.log('Pulling published facts from upstream registry...');
        
        const result = await pullFactsFromRemote(namespaces);
        
        console.log(`Pull complete:`);
        console.log(`  Pulled: ${result.pulled}`);
        console.log(`  Skipped: ${result.skipped}`);
        console.log(`  Conflicts: ${result.conflicts}`);
        
        if (result.facts.length > 0) {
            console.log('');
            console.log('Pulled facts:');
            result.facts.forEach(fact => {
                console.log(`  - ${fact.namespace}/${fact.key}`);
            });
        }
    } catch (error) {
        console.error('Pull failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

async function pushCommand(args: string[]) {
    try {
        const namespaces = args.length > 0 ? args : undefined;
        console.log('Pushing proposed facts to upstream staging...');
        
        const result = await pushFactsToRemote(namespaces);
        
        console.log(`Push complete:`);
        console.log(`  Pushed: ${result.pushed}`);
        console.log(`  Failed: ${result.failed}`);
        
        if (result.facts.length > 0) {
            console.log('');
            console.log('Pushed facts:');
            result.facts.forEach(fact => {
                console.log(`  - ${fact.namespace}/${fact.key}`);
            });
        }
    } catch (error) {
        console.error('Push failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}

main().catch(error => {
    console.error('CLI error:', error);
    process.exit(1);
});

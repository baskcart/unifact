import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(join(tmpdir(), 'unifact-mcp-verify-'));
const databasePath = join(tempRoot, 'store.db');

const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(repoRoot, 'dist', 'mcp.js')],
    env: {
        ...process.env,
        DATABASE_PATH: databasePath
    }
});

const client = new Client({
    name: 'unifact-mcp-verifier',
    version: '1.0.0'
});

try {
    await client.connect(transport);

    const instructions = client.getInstructions();
    assert.match(instructions ?? '', /organization-specific truth/i);
    assert.match(instructions ?? '', /sync_pull/);

    const { tools } = await client.listTools();
    assert.ok(tools.length >= 29, `Expected at least 29 tools, received ${tools.length}`);
    assert.ok(tools.some((tool) => tool.name === 'find_relevant_facts'));
    assert.ok(tools.some((tool) => tool.name === 'sync_pull'));
    assert.ok(tools.some((tool) => tool.name === 'registry_status'));
    assert.ok(tools.some((tool) => tool.name === 'request_registry_join'));
    assert.ok(tools.some((tool) => tool.name === 'list_registry_join_requests'));
    assert.ok(tools.some((tool) => tool.name === 'approve_registry_join'));

    const { prompts } = await client.listPrompts();
    assert.ok(prompts.some((prompt) => prompt.name === 'fact_check'));

    const prompt = await client.getPrompt({
        name: 'fact_check',
        arguments: {
            task: 'Confirm the organization refund policy before changing customer-facing copy'
        }
    });
    assert.match(prompt.messages[0]?.content.type === 'text' ? prompt.messages[0].content.text : '', /find_relevant_facts/);

    console.log(JSON.stringify({
        ok: true,
        toolCount: tools.length,
        promptNames: prompts.map((prompt) => prompt.name),
        hasInstructions: Boolean(instructions)
    }));
} finally {
    await client.close().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
}

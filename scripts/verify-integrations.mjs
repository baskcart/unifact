import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = join(repoRoot, 'integrations', 'unifact-agent-plugin');
const skillPath = join(pluginRoot, 'skills', 'unifact-fact-check', 'SKILL.md');
const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
const antigravityPlugin = JSON.parse(await readFile(join(pluginRoot, 'plugin.json'), 'utf8'));
const antigravityMcp = JSON.parse(await readFile(join(pluginRoot, 'mcp_config.json'), 'utf8'));
const claudePlugin = JSON.parse(await readFile(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
const claudeMcp = JSON.parse(await readFile(join(pluginRoot, '.mcp.json'), 'utf8'));
const desktopManifest = JSON.parse(await readFile(join(repoRoot, 'integrations', 'claude-desktop', 'manifest.json'), 'utf8'));
const linkedRoot = join(repoRoot, 'integrations', 'claude-desktop-linked');
const linkedManifest = JSON.parse(await readFile(join(linkedRoot, 'manifest.json'), 'utf8'));
const skill = await readFile(skillPath, 'utf8');

assert.equal(packageJson.bin['unifact-mcp'], './dist/mcp.js');
assert.equal(antigravityPlugin.name, 'unifact');
assert.equal(antigravityMcp.mcpServers.unifact.command, 'node');
assert.equal(claudePlugin.name, 'unifact');
assert.match(claudeMcp.mcpServers.unifact.args[0], /CLAUDE_PLUGIN_ROOT/);
assert.equal(desktopManifest.manifest_version, '0.3');
assert.equal(desktopManifest.server.entry_point, 'server/mcp.js');
assert.equal(desktopManifest.server.mcp_config.env.DATABASE_PATH, '${user_config.database_path}');
assert.equal(desktopManifest.user_config.database_path.type, 'file');
assert.equal(desktopManifest.user_config.database_path.required, true);
assert.equal(desktopManifest.tools_generated, true);
assert.equal(linkedManifest.name, 'unifact-this-machine');
assert.equal(linkedManifest.server.mcp_config.command, 'C:\\Program Files\\nodejs\\node.exe');
assert.equal(linkedManifest.server.mcp_config.env.UNIFACT_REPO_ROOT, 'C:\\Users\\admin\\git\\unifact');
assert.equal(linkedManifest.server.mcp_config.env.DATABASE_PATH, 'C:\\Users\\admin\\git\\unifact\\store.db');
assert.equal(linkedManifest.user_config, undefined);
assert.match(skill, /organization-specific or potentially changing truth/i);
assert.match(skill, /Do not use for generic programming knowledge/i);
assert.match(skill, /do not publish/i);

const tempRoot = await mkdtemp(join(tmpdir(), 'unifact-plugin-verify-'));
const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(pluginRoot, 'server', 'launch-mcp.mjs')],
    env: {
        ...process.env,
        DATABASE_PATH: join(tempRoot, 'store.db')
    }
});
const client = new Client({ name: 'unifact-plugin-verifier', version: '1.0.0' });

try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.ok(tools.some((tool) => tool.name === 'find_relevant_facts'));
    assert.match(client.getInstructions() ?? '', /organization-specific truth/i);
} finally {
    await client.close().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
}

const linkedTempRoot = await mkdtemp(join(tmpdir(), 'unifact-linked-verify-'));
const linkedTransport = new StdioClientTransport({
    command: process.execPath,
    args: [join(linkedRoot, 'server', 'launch-linked.mjs')],
    env: {
        ...process.env,
        UNIFACT_REPO_ROOT: repoRoot,
        DATABASE_PATH: join(linkedTempRoot, 'store.db')
    }
});
const linkedClient = new Client({ name: 'unifact-linked-verifier', version: '1.0.0' });

try {
    await linkedClient.connect(linkedTransport);
    const { tools } = await linkedClient.listTools();
    assert.ok(tools.some((tool) => tool.name === 'find_relevant_facts'));
} finally {
    await linkedClient.close().catch(() => undefined);
    await rm(linkedTempRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({
    ok: true,
    packageExecutable: 'unifact-mcp',
    antigravityPlugin: antigravityPlugin.name,
    claudePlugin: claudePlugin.name,
    claudeDesktopManifest: desktopManifest.manifest_version,
    claudeLinkedManifest: linkedManifest.name,
    skill: 'unifact-fact-check'
}));

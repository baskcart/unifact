import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';

const repoRoot = resolve(process.env.UNIFACT_REPO_ROOT ?? '');
if (!process.env.UNIFACT_REPO_ROOT) {
    throw new Error('UNIFACT_REPO_ROOT is required; edit the UniFact extension settings');
}

const entry = join(repoRoot, 'dist', 'mcp.js');
try {
    await access(entry);
} catch {
    throw new Error(`UniFact MCP build not found at ${entry}. Run npm run build in ${repoRoot}.`);
}

const module = await import(pathToFileURL(entry).href);
if (typeof module.runStdioMcpServer !== 'function') {
    throw new Error(`UniFact build at ${entry} does not export runStdioMcpServer; rebuild the repository`);
}

await module.runStdioMcpServer();

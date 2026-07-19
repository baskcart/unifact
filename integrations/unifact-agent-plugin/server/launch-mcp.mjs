#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceCheckoutEntry = resolve(pluginRoot, '..', '..', 'dist', 'mcp.js');
const configuredEntry = process.env.UNIFACT_MCP_ENTRY
    ? resolve(process.env.UNIFACT_MCP_ENTRY)
    : null;
const entry = configuredEntry || (existsSync(sourceCheckoutEntry) ? sourceCheckoutEntry : null);

if (!process.env.DATABASE_PATH) {
    process.env.DATABASE_PATH = join(homedir(), '.unifact', 'store.db');
}
mkdirSync(dirname(process.env.DATABASE_PATH), { recursive: true });

if (entry) {
    if (!existsSync(entry)) {
        console.error(`[unifact] MCP entry does not exist: ${entry}`);
        process.exit(1);
    }
    const { runStdioMcpServer } = await import(pathToFileURL(entry).href);
    await runStdioMcpServer();
} else {
    const executable = process.platform === 'win32' ? 'unifact-mcp.cmd' : 'unifact-mcp';
    const child = spawn(executable, [], {
        env: process.env,
        stdio: 'inherit',
        windowsHide: true
    });
    child.once('error', (error) => {
        console.error(
            `[unifact] Could not start ${executable}. Install the UniFact package or set UNIFACT_MCP_ENTRY to dist/mcp.js: ${error.message}`
        );
        process.exit(1);
    });
    child.once('exit', (code, signal) => {
        if (signal) process.kill(process.pid, signal);
        process.exit(code ?? 1);
    });
}

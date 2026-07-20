import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stageRoot = join(repoRoot, '.mcpb-build');
const cacheRoot = join(repoRoot, '.mcpb-cache');
const releaseRoot = join(repoRoot, 'release');
const manifestSource = join(repoRoot, 'integrations', 'claude-desktop', 'manifest.json');
const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
const output = join(releaseRoot, `unifact-${packageJson.version}-win32.mcpb`);

async function run(command, args, cwd) {
    await new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, {
            cwd,
            env: process.env,
            stdio: 'inherit',
            windowsHide: true,
            shell: false
        });
        child.once('error', reject);
        child.once('exit', (code) => {
            if (code === 0) resolvePromise();
            else reject(new Error(`${command} exited with code ${code}`));
        });
    });
}

await rm(stageRoot, { recursive: true, force: true });
await mkdir(join(stageRoot, 'server'), { recursive: true });
await mkdir(releaseRoot, { recursive: true });

const manifest = JSON.parse(await readFile(manifestSource, 'utf8'));
manifest.version = packageJson.version;
await writeFile(join(stageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(join(repoRoot, 'dist'), join(stageRoot, 'server'), { recursive: true });
await cp(
    join(repoRoot, 'integrations', 'claude-desktop', '.mcpbignore'),
    join(stageRoot, '.mcpbignore')
);

await writeFile(
    join(stageRoot, 'package.json'),
    `${JSON.stringify({
        name: 'unifact-claude-desktop-bundle',
        private: true,
        version: packageJson.version,
        dependencies: packageJson.dependencies
    }, null, 2)}\n`
);

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this builder through npm so npm_execpath is available');
const mcpbCli = join(repoRoot, 'node_modules', '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js');

await run(process.execPath, [
    npmCli,
    'install',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--cache',
    cacheRoot
], stageRoot);
await run(process.execPath, [mcpbCli, 'validate', stageRoot], repoRoot);
await run(process.execPath, [mcpbCli, 'pack', stageRoot, output], repoRoot);

console.log(`Created ${output}`);

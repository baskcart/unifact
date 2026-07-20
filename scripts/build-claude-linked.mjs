import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = join(repoRoot, 'integrations', 'claude-desktop-linked');
const stageRoot = join(repoRoot, '.mcpb-build-linked');
const releaseRoot = join(repoRoot, 'release');
const packageJson = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
const output = join(releaseRoot, `unifact-this-machine-${packageJson.version}-win32.mcpb`);

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
        child.once('exit', (code) => code === 0
            ? resolvePromise()
            : reject(new Error(`${command} exited with code ${code}`)));
    });
}

await rm(stageRoot, { recursive: true, force: true });
await mkdir(stageRoot, { recursive: true });
await mkdir(releaseRoot, { recursive: true });
await cp(sourceRoot, stageRoot, { recursive: true });

const manifestPath = join(stageRoot, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.version = packageJson.version;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const mcpbCli = join(repoRoot, 'node_modules', '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js');
await run(process.execPath, [mcpbCli, 'validate', stageRoot], repoRoot);
await run(process.execPath, [mcpbCli, 'pack', stageRoot, output], repoRoot);

console.log(`Created ${output}`);

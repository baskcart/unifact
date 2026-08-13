#!/usr/bin/env node
/**
 * Export published UniFact records to a local folder (or Drive-synced folder).
 *
 * Usage:
 *   node sync-published-to-drive-folder.mjs
 *
 * Env:
 *   UNIFACT_URL       https://staging.unifact.ai
 *   UNIFACT_API_KEY   person key (read)
 *   UNIFACT_NAMESPACES  comma list, e.g. company.policy,company.branding
 *   OUTPUT_DIR          path to folder (Google Drive File Stream / sync folder)
 *
 * Point Gemini Enterprise Drive data store at OUTPUT_DIR / Shared drive folder
 * so Workspace Gemini can ground on published facts — not raw draft Docs.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const base = (process.env.UNIFACT_URL || '').replace(/\/$/, '');
const key = process.env.UNIFACT_API_KEY || '';
const namespaces = (process.env.UNIFACT_NAMESPACES || 'company.guidelines,company.branding,company.policy')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const outDir = process.env.OUTPUT_DIR || path.join(process.cwd(), 'published-facts');

if (!base || !key) {
  console.error('Set UNIFACT_URL and UNIFACT_API_KEY');
  process.exit(1);
}

async function getJson(urlPath) {
  const res = await fetch(`${base}${urlPath}`, {
    headers: { 'X-API-Key': key, Accept: 'application/json' }
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${urlPath}: ${await res.text()}`);
  }
  return res.json();
}

function slug(ns, k) {
  return `${ns.replace(/\./g, '_')}__${k}`.replace(/[^\w.-]+/g, '_');
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  let written = 0;

  for (const ns of namespaces) {
    const data = await getJson(
      `/v1/facts/${encodeURIComponent(ns)}?registry_channel=published&lookup=false`
    );
    const facts = Array.isArray(data) ? data : data.facts || [];
    for (const fact of facts) {
      if (fact.registry_channel && fact.registry_channel !== 'published') continue;
      const body = [
        `# ${fact.namespace}/${fact.key}`,
        '',
        fact.description ? `_${fact.description}_` : '',
        '',
        String(fact.value ?? ''),
        '',
        '---',
        `channel: ${fact.registry_channel || 'published'}`,
        fact.source ? `source: ${fact.source}` : '',
        fact.published_at ? `published_at: ${fact.published_at}` : '',
        `path: ${fact.namespace}/${fact.key}`,
        ''
      ]
        .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
        .join('\n');

      const file = path.join(outDir, `${slug(fact.namespace, fact.key)}.md`);
      await fs.writeFile(file, body, 'utf8');
      written += 1;
    }
  }

  console.log(`Wrote ${written} published fact file(s) to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

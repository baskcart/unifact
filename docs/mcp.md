# UniFact MCP — shared interface for work agents

UniFact MCP is the **default path** for work agents (Cursor, Codex, Claude, Devin, Antigravity, Cowork, and similar). Do not treat README or source spelunking as org truth when the registry may already hold the answer.

## What you get

Stdio MCP server (`npm run mcp` / `src/mcp.ts`) exposes tools such as:

- `sync_pull` / `sync_push` / `sync_status`
- `list_facts` / `get_fact` / `search_facts` / `find_relevant_facts`
- `propose_fact` / `upsert_fact` / `publish_fact` / `feedback_fact`
- `extract_facts_from_document` (heuristic; product demos may use Bedrock separately)

Identity = active local person key (`uni use <person>`), same as the CLI.

## Machine setup (any MCP client)

1. Clone and install this repo; ensure `better-sqlite3` matches the **same Node major** the MCP process will use (`node -v`, then `npm rebuild better-sqlite3` if needed).
2. Copy [`.cursor/mcp.json.example`](../.cursor/mcp.json.example) to your client config and replace `REPO` / Node paths.
3. Prefer an **absolute path to the system `node` binary** that matches `better-sqlite3`. Bundled runtimes (e.g. some IDE Node builds) often break native modules.
4. Set `DATABASE_PATH` to this repo’s `store.db` (or your working-store path).
5. Create/approve a work-agent person in the org registry (example: `cursorAgent`), then `uni use <that-person>` before relying on propose/push.

### Cursor

- Global: `~/.cursor/mcp.json`
- Or project: `.cursor/mcp.json` (gitignored locally; start from the example)
- Project rules: `.cursor/rules/unifact-mcp.mdc` (committed) — UniFact MCP first

### Claude Desktop / Cowork / other MCP hosts

Add the same server block under that product’s `mcpServers` (or equivalent). Command/args/env stay identical — that is the shared interface.

### Codex, Devin, Antigravity, etc.

If the product supports MCP stdio servers, use the same command. If it only supports HTTP tools later, call the UniFact HTTP API with the person API key — still the registry, not ad-hoc docs.

## Operator checklist (avoid common failures)

| Symptom | Fix |
|--------|-----|
| `Cannot find module .../src/mcp.ts` under home dir | Do not rely on `cwd` alone; pass **absolute** paths to `tsx` and `mcp.ts` |
| `NODE_MODULE_VERSION` / `better_sqlite3.node` mismatch | Point `command` at the Node that built native modules, or rebuild: `npm rebuild better-sqlite3` |
| MCP connects then dies / parse errors | Keep **stdout** JSON-RPC-only (no `console.log` on the stdio path); logs go to stderr |
| Wrong attribution on proposes | `uni use <workAgentPerson>` — do not leave owner `admin` active for agent writes |

## Related facts (when published)

- `company.constraints/work_session_fact_check`
- `company.constraints/work_agent_mcp_interface`
- `infra/canonical_host` / `infra/host_redirect_policy` (site hosting)

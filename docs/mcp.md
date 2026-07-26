# UniFact MCP — shared interface for work agents

UniFact MCP is the **default path** for work agents (Cursor, Codex, Claude, Devin, Antigravity, Cowork, and similar). Do not treat README or source spelunking as org truth when the registry may already hold the answer.

## What you get

Stdio MCP server (`unifact-mcp`, `npm run mcp`, or `dist/mcp.js`) exposes tools such as:

- `sync_pull` / `sync_push` / `sync_status`
- `list_facts` / `get_fact` / `search_facts` / `find_relevant_facts`
- Optional `at` / `as_of` on `get_fact` and `list_facts` for point-in-time (production lifecycle); `get_fact_as_of` / `list_facts_as_of` are aliases with required `at`
- `propose_fact` / `upsert_fact` / `publish_fact` / `feedback_fact` — prefer `source` + structured `evidence`
- `audit_fact` / `export_audit_log` — history and org export including **actor**
- `history_fact` — lifecycle versions and/or compact audit for one key (`mode`: history|audit|all; also `uni history`)
- `extract_facts_from_document` (heuristic; product demos may use Bedrock separately)
- `fact_check` prompt for a read-first grounding workflow
- `registry_status` / `request_registry_join` for no-command-line onboarding
- `list_registry_join_requests` / `approve_registry_join` for explicitly confirmed owner review

The MCP initialization response also tells compatible agents when to discover UniFact: organization policies, decisions, ownership, customer commitments, product identity, infrastructure, compliance, operations, and conflicting internal claims.

Identity = active local person key (`uni use <person>`), same as the CLI.

### No-command-line registry onboarding

Claude Desktop and other MCP agents can onboard a non-technical user without a terminal:

1. `registry_status` explains whether a local identity, registry, and upstream are ready.
2. After the user explicitly names the registry and identity, `request_registry_join` creates a local device key and submits it to the hosted registry in a disabled state. The key is sent directly over HTTPS and is never returned to the model.
3. A hosted registry owner calls `list_registry_join_requests`, then explicitly confirms `approve_registry_join` for the named identity.
4. Approval activates the same device key. The joining user calls `sync_pull`; there is no secret-copy step.

The hosted API must run the same onboarding-capable release before these tools can complete against it.

## Machine setup (any MCP client)

1. Clone, install, and build this repo. Ensure `better-sqlite3` matches the **same Node major** the MCP process will use (`node -v`, then `npm rebuild better-sqlite3` if needed).
2. Configure the client to run the built `dist/mcp.js`, or run `npm link` and use `unifact-mcp`.
3. Prefer an **absolute path to the system `node` binary** that matches `better-sqlite3`. Bundled runtimes (e.g. some IDE Node builds) often break native modules.
4. Set `DATABASE_PATH` to this repo’s `store.db` (or your working-store path).
5. Create/approve a work-agent person in the org registry (example: `cursorAgent`), then `uni use <that-person>` before relying on propose/push.

### Cursor

- Global: `~/.cursor/mcp.json`
- Or project: `.cursor/mcp.json` (gitignored locally; start from the example)
- Project rules: `.cursor/rules/unifact-mcp.mdc` (committed) — UniFact MCP first

### Antigravity

- Global MCP config: `~/.gemini/config/mcp_config.json`
- Global skill: `~/.gemini/config/skills/unifact-fact-check/`
- Distributable plugin source: [`integrations/unifact-agent-plugin`](../integrations/unifact-agent-plugin)

Refresh **Settings → Customizations** after changing the global configuration.

### Claude Code

The shared plugin bundles `.mcp.json` and the model-invoked Fact Check skill:

```text
claude --plugin-dir ./integrations/unifact-agent-plugin
```

Run `/reload-plugins`, then `/mcp` to verify the server and `/unifact:unifact-fact-check` for explicit invocation. The skill can also activate automatically from task context.

### Claude Desktop

Build the self-contained Windows development bundle:

```text
npm run build:claude-desktop
```

Install the resulting `.mcpb` from **Settings → Extensions → Advanced settings → Install Extension**. During setup, select an existing UniFact SQLite database to share facts across agents, or keep `~/.unifact/store.db` for a separate Claude store.

If Claude reports a `better-sqlite3` native-module mismatch, use the machine-specific repository-linked build:

```text
npm run build:claude-linked
```

It launches `C:\Program Files\nodejs\node.exe`, imports `dist/mcp.js` from the selected checkout, and uses the selected repository database. Re-run `npm run build` after source changes; Claude will pick up the rebuilt code when the MCP server restarts.

### Claude.ai / Cowork

These clients require a public streamable-HTTP MCP endpoint. UniFact currently provides stdio MCP plus an authenticated REST API; the remote MCP/OAuth deployment is a separate production stage and must not be represented as available until deployed. See the [remote MCP security and deployment plan](remote-mcp.md).

### Codex, Devin, and other stdio MCP hosts

If the product supports MCP stdio servers, use the same command. If it only supports HTTP tools later, call the UniFact HTTP API with the person API key — still the registry, not ad-hoc docs.

## Operator checklist (avoid common failures)

| Symptom | Fix |
|--------|-----|
| `Cannot find module .../dist/mcp.js` | Run `npm run build` and use an absolute path |
| `NODE_MODULE_VERSION` / `better_sqlite3.node` mismatch | Point `command` at the Node that built native modules, or rebuild: `npm rebuild better-sqlite3` |
| MCP connects then dies / parse errors | Keep **stdout** JSON-RPC-only (no `console.log` on the stdio path); logs go to stderr |
| Wrong attribution on proposes | `uni use <workAgentPerson>` — do not leave owner `admin` active for agent writes |

## Agent-use policy

1. Use UniFact only when the task depends on organization-specific or potentially changing truth.
2. Check `sync_status`; call `sync_pull` when an upstream is configured.
3. Use `find_relevant_facts`, then `search_facts` or `get_fact` as needed.
4. Prefer published facts and label non-published lifecycle states as context.
5. Do not invent policy when no fact exists.
6. Propose only with user approval. Publishing and destructive lifecycle actions require explicit authorization.
7. When proposing, set `source` and structured `evidence` (`url` / `ticket` / `conversation_id`) so later audits can challenge the claim. Use `get_fact` with `at`/`as_of` (or alias `get_fact_as_of`) when you need what was published at time T.

## Related facts (when published)

- `company.constraints/work_session_fact_check`
- `company.constraints/work_agent_mcp_interface`
- `infra/canonical_host` / `infra/host_redirect_policy` (site hosting)

# Frameworks & agents — discovering UniFact

UniFact is meant to be **found and used** by work-agent hosts and app frameworks without scraping READMEs for org truth.

## Probe (any HTTP client)

```http
GET /.well-known/unifact.json
GET /v1/discovery
```

No API key. Returns name, docs links, auth model, bootstrap env, and where non-secret config lives (`company.infrastructure/*`).

Example host: `https://staging.unifact.ai/.well-known/unifact.json`

## Integration paths

| Consumer | How |
|----------|-----|
| **Cursor / Claude Code/Desktop / Codex / Antigravity** | Stdio MCP and agent plugin — [`docs/mcp.md`](mcp.md) |
| **HTTP apps (Next.js, etc.)** | `UNIFACT_URL` + person/service key → `/v1/facts/...` |
| **CLI** | `uni` — pull / push / propose / publish |
| **Custom agents** | Same MCP tools or REST; Fact Check first |

## Bootstrap vs facts

```text
Env / secrets   →  UNIFACT_URL, API key, OAuth client secrets, AUTH_SECRET
UniFact facts   →  auth-url, auth-github-id, upstream URL, brand, product decisions
```

Details: [`config-as-facts.md`](config-as-facts.md) · Auth.js-style loader example: [`examples/authjs-config-from-facts.ts`](../examples/authjs-config-from-facts.ts)

## What not to PR upstream (yet)

| Idea | Verdict |
|------|---------|
| “UniFact provider” inside Auth.js | **Wrong layer** — UniFact is not an IdP; GitHub/Google stay the IdP |
| Auth.js loads `clientId` from UniFact | **App concern** — use the example loader in *your* app; upstream Auth.js won’t special-case UniFact early |
| Cursor / Codex “native UniFact” | Prefer **MCP** (already works) over product-specific forks |
| npm `unifact` / `uni` CLI | Publish/link this package; keywords help discovery |

Visibility today = **well-known discovery + stdio MCP + Fact Check skill + Antigravity/Claude packages + docs + examples**. A public streamable-HTTP MCP endpoint with OAuth is still required for Claude.ai, Cowork, and other cloud-hosted connectors; follow the [remote MCP plan](remote-mcp.md) rather than sharing a local agent key.

## Checklist for a new framework adapter

1. Call `GET {host}/.well-known/unifact.json`.
2. Require only bootstrap URL + key (or MCP stdio).
3. `sync_pull` / list `company.infrastructure` (and org namespaces).
4. Never store client secrets or `AUTH_SECRET` as facts.
5. Point humans at [unifact.ai](https://www.unifact.ai) for GitHub org create; agents use the printed API key.

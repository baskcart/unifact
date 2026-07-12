# UniFact — work agent bootstrap

This repo is the **org fact registry**. Work agents (Cursor, Codex, Claude, Devin, Antigravity, Cowork, etc.) should use **UniFact MCP** as the shared interface for org truth — not README-first exploration.

1. Configure MCP from [`docs/mcp.md`](docs/mcp.md) / [`.cursor/mcp.json.example`](.cursor/mcp.json.example).
2. Fact Check: `sync_pull` then `search_facts` / `list_facts` / `find_relevant_facts`.
3. Propose facts via MCP; humans/owners publish when required.
4. Cursor project rule: [`.cursor/rules/unifact-mcp.mdc`](.cursor/rules/unifact-mcp.mdc).

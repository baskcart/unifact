# UniFact agent plugin

This package combines the UniFact MCP server with a model-invoked Fact Check skill.

## Antigravity

Install this directory as a plugin, or copy it to `~/.gemini/config/plugins/unifact`. Refresh **Settings → Customizations** after installation.

During source development, run `npm install && npm run build` in the UniFact repository first. A distributed installation requires the `unifact-mcp` executable on `PATH`, unless `UNIFACT_MCP_ENTRY` points to a built `dist/mcp.js`.

## Claude Code

Test from the repository with:

```text
claude --plugin-dir ./integrations/unifact-agent-plugin
```

The plugin stores its local working database in Claude's persistent plugin-data directory. Run `/reload-plugins` after changes and `/mcp` to inspect the server.

## Safety

The skill may read governed facts and suggest proposals. Publishing, approval, rejection, retraction, supersession, and deletion require explicit user authorization.

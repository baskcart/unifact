# Microsoft 365 Copilot — Uni (@Uni)

## End-user experience

In **Microsoft 365 Copilot** or **Teams**, type:

```text
@Uni what is our return window?
```

Uni searches UniFact, prefers **published** facts, and replies with a citation:

```text
**Published:** `company.policy/return_window`
Value: …
```

Optional: ask Uni to **propose** a fact — it creates `proposed` only; humans publish.

There is no separate `@fact` agent. Conversation starters cover “look up a fact.”

## Implementation in this repo

| Artifact | Path |
|----------|------|
| Agent instructions | [`integrations/uni-agent/INSTRUCTIONS.md`](../../integrations/uni-agent/INSTRUCTIONS.md) |
| OpenAPI (custom connector) | [`integrations/uni-agent/openapi.yaml`](../../integrations/uni-agent/openapi.yaml) |
| Declarative agent package | [`integrations/m365-copilot/`](../../integrations/m365-copilot/) |
| Install steps | [`integrations/m365-copilot/README.md`](../../integrations/m365-copilot/README.md) |

## Admin checklist

1. Host UniFact over HTTPS.
2. Create person `uniAgent` with API key (read + optional propose write).
3. Copilot Studio: agent **Uni** + OpenAPI tools, or sideload `appPackage`.
4. Store `X-API-Key` in connector vault (`UNIFACT_API_KEY`).
5. Publish agent to Entra groups; users @mention **Uni**.

## Related

- [Google Workspace Uni](google-workspace.md)
- [MCP for coding agents](../mcp.md)
- [Remote MCP plan](../remote-mcp.md) (GitHub Copilot cloud / future Studio MCP)

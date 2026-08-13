# Google Workspace — Uni (@Uni)

## End-user experience

In **Google Chat**, type:

```text
@Uni what is our brand tagline?
```

Uni searches UniFact and cites published facts as `` `namespace/key` ``.

Propose from Chat:

```text
propose company.policy/return_window = 30 days from delivery
```

Creates a **proposed** fact only.

For **Gemini Enterprise**, select the **Uni** agent (same instructions + OpenAPI tools). Optional: ground Gemini Drive search on a **Published facts** folder synced from UniFact — not the entire Drive.

## Implementation in this repo

| Artifact | Path |
|----------|------|
| Chat Apps Script | [`integrations/google-workspace/apps-script/`](../../integrations/google-workspace/apps-script/) |
| Drive export sync | [`integrations/google-workspace/sync-published-to-drive-folder.mjs`](../../integrations/google-workspace/sync-published-to-drive-folder.mjs) |
| Gemini instructions | [`integrations/google-workspace/gemini-agent-instructions.md`](../../integrations/google-workspace/gemini-agent-instructions.md) |
| Install steps | [`integrations/google-workspace/README.md`](../../integrations/google-workspace/README.md) |
| Shared OpenAPI | [`integrations/uni-agent/openapi.yaml`](../../integrations/uni-agent/openapi.yaml) |

## Admin checklist

1. Host UniFact + `uniAgent` API key.
2. Deploy Chat app from Apps Script; set `UNIFACT_URL` / `UNIFACT_API_KEY` script properties.
3. Optional: schedule Drive sync; attach folder to Gemini Enterprise Drive data store.
4. Optional: Gemini agent with OpenAPI tools from `openapi.yaml`.

## Related

- [M365 Copilot Uni](m365-copilot.md)
- [MCP / Antigravity](../mcp.md)
- [Frameworks](../frameworks.md)

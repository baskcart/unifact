# Uni for Google Workspace

End users **`@Uni`** in Google Chat (or open the Uni Chat app). Uni Fact-Checks UniFact and cites published facts.

## Package layout

```text
integrations/google-workspace/
  README.md
  apps-script/
    Code.gs              # Chat app handler
    appsscript.json
  sync-published-to-drive-folder.mjs   # export published facts → Drive folder
  gemini-agent-instructions.md         # paste into Gemini Enterprise agent
```

Shared API: [`../uni-agent/openapi.yaml`](../uni-agent/openapi.yaml)  
Shared policy: [`../uni-agent/INSTRUCTIONS.md`](../uni-agent/INSTRUCTIONS.md)

## Prerequisites

1. Hosted UniFact HTTPS origin + `uniAgent` person API key.
2. Google Workspace admin able to configure Chat apps / Gemini Enterprise (optional).
3. Apps Script project with Chat API enabled.

## Path A — Google Chat `@Uni` (recommended first)

1. Create a new **Apps Script** project; copy `apps-script/Code.gs` and `appsscript.json`.
2. **Project Settings → Script properties:**
   - `UNIFACT_URL` = `https://staging.unifact.ai` (your host)
   - `UNIFACT_API_KEY` = `uniAgent` key
3. Deploy → **New deployment** → type **Add-on** / configure as **Google Chat app** (follow current Google Chat apps docs for Apps Script).
4. In Google Cloud Console for the project: enable Chat API; set the Chat app avatar name to **Uni**.
5. Install the app for your Workspace (admin or user install).
6. In Chat: `@Uni what is our brand tagline?`

### Propose from Chat

```text
propose company.policy/return_window = 30 days from delivery for unused items
```

Creates a **proposed** fact only.

## Path B — Gemini Enterprise agent

1. Create a Gemini Enterprise / Vertex agent named **Uni**.
2. Paste [`gemini-agent-instructions.md`](gemini-agent-instructions.md).
3. Add an OpenAPI / HTTP tool from [`../uni-agent/openapi.yaml`](../uni-agent/openapi.yaml) with header `X-API-Key`.
4. Publish to Gemini Enterprise web and/or Workspace Chat.

## Path C — Drive folder for Gemini search grounding

Prefer an **OKF export** of published facts (portable, typed concepts):

```bash
uni export --okf "G:\Shared drives\UniFact Published"
```

Or the simpler markdown sync script:

```bash
set UNIFACT_URL=https://staging.unifact.ai
set UNIFACT_API_KEY=...
set UNIFACT_NAMESPACES=company.guidelines,company.branding,company.policy
set OUTPUT_DIR=G:\Shared drives\UniFact Published
node integrations/google-workspace/sync-published-to-drive-folder.mjs
```

Schedule every 15–60 minutes. Point Gemini Enterprise Google Drive data store filters at that folder only.

See also [`docs/okf.md`](../../docs/okf.md) (`uni export --okf` / `uni import-okf`).

**Do not** index all of Drive as “truth.” Only the published export folder.

## End-user experience

| Surface | What users do |
|---------|----------------|
| Google Chat | `@Uni what’s our return policy?` |
| Propose | `propose ns/key = value` |
| Gemini agent | Select **Uni** or ask via Chat wiring |
| Docs (later) | Sidebar add-on — not in this pack yet |

Reply shape matches M365 Uni: **Published:** `` `namespace/key` `` + value.

## Security

- Dedicated `uniAgent` key in Script Properties / Secret Manager — never in Chat messages.
- Propose only; humans publish in UniFact CLI/UI.
- Limit Drive sync to published namespaces.

## Related

- M365 pack: [`../m365-copilot/README.md`](../m365-copilot/README.md)
- Docs: [`../../docs/integrations/google-workspace.md`](../../docs/integrations/google-workspace.md)

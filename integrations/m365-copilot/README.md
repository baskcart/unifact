# Uni for Microsoft 365 Copilot

End users type **`@Uni`** in Microsoft 365 Copilot chat or Teams. Uni Fact-Checks UniFact and cites published facts.

## Package layout

```text
integrations/m365-copilot/
  INSTRUCTIONS.md          # full agent policy (source of truth for authors)
  README.md                # this file
  appPackage/
    manifest.json          # Teams / M365 app shell
    declarativeAgent.json  # @Uni agent definition
    ai-plugin.json         # API plugin (actions)
    openapi.yaml           # UniFact REST (search / relevant / get / upsert)
    color.png / outline.png
```

Shared OpenAPI also lives at `integrations/uni-agent/openapi.yaml`.

## Prerequisites

1. Hosted UniFact with HTTPS (e.g. `https://staging.unifact.ai`).
2. Person key for the agent, e.g. `uniAgent`:
   - Owner: create/approve person with **read** (and **write** only if propose is allowed).
   - Prefer write scoped so the key can create `proposed` facts but humans still publish.
3. Microsoft 365 tenant with Copilot / Copilot Studio rights to sideload or publish agents.
4. Replace `00000000-0000-0000-0000-00000000UNI1` in `manifest.json` with a real GUID before production.

## Install options

### A. Copilot Studio (fastest for your tenant)

1. Create a new **agent for Microsoft 365 Copilot**.
2. Name: **Uni**. Description: org truth / One Fact. One Truth.
3. Paste instructions from `INSTRUCTIONS.md` (or the shorter text in `declarativeAgent.json`).
4. Add a **custom connector** (or OpenAPI tool) using `appPackage/openapi.yaml`.
5. Set auth to API key header `X-API-Key` = your `uniAgent` key (store in connector credentials / vault — never in chat).
6. Set server URL to your UniFact host.
7. Enable actions: `searchFacts`, `findRelevantFacts`, `getFact`, and optionally `upsertFact`.
8. Add conversation starters from `declarativeAgent.json`.
9. Publish to **Teams and Microsoft 365 Copilot**.
10. Admin approves the agent for your Entra groups.

### B. Declarative agent app package (Agents Toolkit / sideload)

1. Install [Microsoft 365 Agents Toolkit](https://aka.ms/M365AgentsToolkit) in VS Code.
2. Point a new declarative-agent project at `appPackage/`.
3. Configure plugin vault secret `UNIFACT_API_KEY` (referenced in `ai-plugin.json`).
4. Update `openapi.yaml` `servers[0].url` to your host.
5. Zip `appPackage` (or use Toolkit provision/publish) and sideload / submit for admin approval.
6. Users open Copilot → agents → **Uni**, or type `@Uni`.

### C. Power Platform custom connector only

Import `openapi.yaml` as a custom connector, then attach it to any Copilot Studio agent. Useful if you already have an agent and only need UniFact tools.

## End-user experience

| Step | What the user does |
|------|--------------------|
| 1 | In Copilot or Teams chat, type `@` and choose **Uni** |
| 2 | Ask: `what is our return window?` |
| 3 | Uni calls UniFact, replies with **Published:** `` `namespace/key` `` + value |
| 4 | Optional: “propose a fact” → Uni confirms → creates **proposed** only |

Users never see MCP tool names or API keys.

## Security checklist

- [ ] Dedicated `uniAgent` person (not owner `admin`)
- [ ] Key stored in connector vault / Entra secret — not in instructions
- [ ] Publish / retract / delete **not** exposed as Studio actions
- [ ] `validDomains` in manifest lists only your UniFact hosts
- [ ] Audit: `uni audit` / `export_audit_log` on the host

## Related

- Shared instructions: [`../uni-agent/INSTRUCTIONS.md`](../uni-agent/INSTRUCTIONS.md)
- Google Workspace pack: [`../google-workspace/README.md`](../google-workspace/README.md)
- Docs: [`../../docs/integrations/m365-copilot.md`](../../docs/integrations/m365-copilot.md)
- Remote MCP (future cloud agents): [`../../docs/remote-mcp.md`](../../docs/remote-mcp.md)

# Remote MCP for Claude.ai and hosted agents

UniFact's current MCP server is a local stdio server. Claude.ai, Cowork, and other hosted agents need a public **Streamable HTTP MCP** endpoint protected by OAuth. Do not expose the stdio server directly or reuse one shared `UNIFACT_API_KEY` for every remote user.

## Required architecture

1. Add a public `https://<host>/mcp` Streamable HTTP transport beside the existing REST API.
2. Publish OAuth protected-resource metadata and point it at the selected authorization server.
3. Validate access tokens at the MCP edge and map each token to one UniFact person, organization, and allowed namespaces.
4. Create a fresh MCP server/session per authenticated request or session. Never store a caller's identity in process-global state.
5. Enforce authorization in the store/API layer as well as in tool exposure. Tool descriptions are guidance, not a security boundary.
6. Record the authenticated person, client, action, and result in the audit trail.

## Initial scopes

| Scope | Capability |
|---|---|
| `facts:read` | Sync status/pull and read/search relevant facts |
| `facts:propose` | Create proposals and feedback |
| `facts:review` | Approve or reject proposals |
| `facts:publish` | Publish or retract facts |
| `registry:admin` | Person, key, and organization administration |

Claude's first public connector should request only `facts:read` and optionally `facts:propose`. Review, publication, destructive lifecycle actions, and registry administration should remain unavailable until an operator deliberately grants the corresponding scope.

## Discovery and client behavior

- Keep the server-level UniFact instructions and `fact_check` prompt used by the stdio server.
- Return only tools the current token may invoke, while still checking authorization when each tool executes.
- Treat published facts as authoritative by default and label drafts, proposals, and retracted facts.
- When no relevant fact exists, say so and offer a proposal; never invent organizational policy.
- Require an explicit user confirmation immediately before publish, retract, delete, approve, reject, or key-management operations.

## Production gates

- Choose the authorization server and register OAuth clients for each hosted agent surface.
- Choose the canonical MCP host and TLS/DNS deployment.
- Define organization/person provisioning and revocation behavior.
- Add rate limits, request-size limits, session expiry, and structured security logs.
- Add tests for tenant isolation, namespace permissions, revoked tokens, scope downgrades, prompt injection, confirmation gates, reconnects, and concurrent sessions.
- Complete a privacy/security review and publish support and privacy-policy URLs before marketplace submission.

The remote connector is ready to advertise only after all gates pass against the production host. Until then, discovery must continue to describe UniFact as stdio MCP plus authenticated REST.

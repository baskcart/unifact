# Enterprise readiness

Short pack for platform and security reviewers. UniFact is a **governed fact registry** (org-scoped), not a document wiki or RAG product.

## Tenancy model

| Layer | What it means |
|-------|----------------|
| **Host** | Deployment (e.g. staging.unifact.ai or your VPC) |
| **Registry** | One organization (e.g. `Unifact`) |
| **Person** | Member identity; API key secret ≈ password |
| **Fact** | Unique on `(registry, namespace, key)` |

Membership (`uni init` / `join` / `approve` / `suspend`) controls who can act on an org. Facts never cross orgs in the store.

## Auth today

- **API / MCP / CLI sync:** enabled person API key (`X-API-Key`)
- **Scopes:** read / write on namespace patterns (`*`, `company.*`, …)
- **401:** unknown or disabled key  
- **403:** known key, namespace or scope denied  

Keys are push-only to origin (approve/suspend). Matched secrets local ↔ host are required for pull/push.

## Audit

Every create/update/delete writes `audit_log` (per registry), including **actor** (who) when known. New rows store actor at write time; existing rows are backfilled from version snapshots / authors where possible.

Export:

```bash
uni audit                 # JSON for active org (includes actor)
uni audit --format csv
```

API: `GET /v1/audit?format=json|csv` (authenticated). MCP: `export_audit_log` / `audit_fact`.

### Point-in-time (`as_of`)

Reconstruct what production truth looked like at timestamp T from `fact_versions`:

```bash
uni get policy/return_window --at 2026-01-15T12:00:00Z
uni list policy --at 2026-01-15T12:00:00Z
uni as-of policy/return_window --at 2026-01-15T12:00:00Z   # alias for get --at
```

- MCP: `get_fact` / `list_facts` with optional `at` or `as_of`; aliases `get_fact_as_of` / `list_facts_as_of`
- API: `?as_of=` or `?at=` on `GET /v1/facts/:ns/:key` and `GET /v1/facts/:ns` (also dedicated `/as-of` route)

**Rule:** latest version with `created_at <= T` whose channel is `published`, `superseded`, or `retracted`. If none → never published by T. A retract/supersede at or before T is returned as that status (`as_of_status`).

### Provenance discipline

Prefer non-empty `source`, structured `evidence` (`{ url, ticket, conversation_id, refs, note }`), and `change_reason` on propose/publish. Enforcement (optional):

| Env | Effect |
|-----|--------|
| `UNIFACT_REQUIRE_PROVENANCE=1` | Require `source` on all namespaces |
| `UNIFACT_REQUIRE_PROVENANCE_NAMESPACES=policy,company.*` | Require `source` on matching namespaces |
| `UNIFACT_REQUIRE_EVIDENCE=1` | Also require evidence when source is required |
| `UNIFACT_PROVENANCE_MODE=warn\|block` | Soft warnings vs hard errors (default `block`) |

Automatic capture of every Cursor chat is **not** supported; agents should pass conversation ids when the host provides them.

## Document → proposed facts

Ingest is **propose only** — never auto-publish:

```bash
uni extract ./policy.md
uni facts                 # review candidates
uni publish policy/…
```

MCP: `extract_facts_from_document`.

## Deploy assumptions

- Origin: PostgreSQL (`DATABASE_URL`)
- Laptop: SQLite (`store.db`)
- TLS at the edge; app on an internal port
- Secrets in env / secret manager — never in git (`*.pem`, `.env` ignored)

See [deploy.md](deploy.md).

## Checklist (shipped vs next)

| Item | Status |
|------|--------|
| Org-partitioned facts | Done |
| Membership approve/suspend | Done |
| Audit log + export | Done (`uni audit`, includes actor) |
| Point-in-time as_of | Done (`get`/`list` + `--at`; MCP `at`/`as_of`) |
| Provenance require (env/namespaces) | Done (source; optional evidence) |
| Doc → proposed extract | Done (`uni extract`) |
| MCP propose / publish / pull | Done |
| Security one-pager (this doc) | Done |
| OIDC / IdP → person | **Next** |
| SCIM | Later |
| SIEM / webhook audit stream | Later |
| Auto chat/conversation capture | Later (no host hook yet) |
| Full admin console | Later |

## Reference architecture

```text
[ IdP — next ]     [ Humans: uni CLI ]
       \                 /
        \               /
     [ UniFact API + MCP ]  ← Postgres (origin) or SQLite (local)
               |
        [ Agents / copilots ]
```

Agents consume **published** facts only for production truth; proposed/review stay in the governance path.

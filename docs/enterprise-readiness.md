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

Every create/update/delete writes `audit_log` (per registry). Export:

```bash
uni audit                 # JSON for active org
uni audit --format csv
```

API: `GET /v1/audit?format=json|csv` (authenticated).

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
| Audit log + export | Done (`uni audit`) |
| Doc → proposed extract | Done (`uni extract`) |
| MCP propose / publish / pull | Done |
| Security one-pager (this doc) | Done |
| OIDC / IdP → person | **Next** |
| SCIM | Later |
| SIEM / webhook audit stream | Later |
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

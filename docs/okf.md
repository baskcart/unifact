# UniFact ↔ Open Knowledge Format (OKF)

**OKF** is Google’s open knowledge-bundle format: a directory of Markdown files with YAML frontmatter ([spec](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/HEAD/okf/SPEC.md)).  
**UniFact** is a governed org fact registry (propose → review → publish, MCP / `@Uni`).

They complement each other: **OKF moves knowledge; UniFact decides what agents may treat as true.**

## Mapping

| UniFact | OKF |
|---------|-----|
| Fact `namespace/key` | Concept ID `unifact/<namespace>/<key>` → file `unifact/<namespace>/<key>.md` |
| `value` | Markdown body |
| `description` | `title` / `description` |
| `fact_type` | `type` (see below) |
| `source` + `evidence` | `sources[]` |
| `created_by` / `approved_by` / `published_by` | `verified: human:…` or `agent:…` |
| `relevance_tags` | `tags` |
| `valid_until` | `stale_after` (ISO) |
| Channels / audit / tenancy | **UniFact only** (not replaced by OKF) |

### `fact_type` → OKF `type`

| UniFact `fact_type` | OKF `type` |
|---------------------|------------|
| `constraint_fact` | `Policy` |
| `decision_fact` | `Decision` |
| `preference_fact` | `Preference` |
| `entity_fact` | `Entity` |
| `state_fact` | `State` |
| `insight_fact` | `Insight` |
| `actionable_fact` | `Actionable` |
| (other) | `UniFact` |

Import also accepts OKF `Constraint` and `Playbook` → propose as constraint-like facts.

Every exported concept includes an `unifact:` frontmatter block with namespace, key, channel, and related metadata so round-trips stay stable.

## CLI

```bash
# Published facts → OKF bundle (exchange / git / Gemini Drive folder)
uni export --okf ./okf-bundle
uni export --okf ./okf-bundle --namespace company.policy,company.branding
uni export --okf ./okf-bundle --channel published

# OKF → proposed facts only (never auto-publish)
uni import-okf ./okf-bundle --dry-run
uni import-okf ./okf-bundle
uni import-okf ./policy/shipping.md --namespace company.policy
uni publish company.policy/return_window   # after human review
```

## Agent guidance

1. **Fact Check UniFact** (MCP / `@Uni`) for live published truth.  
2. If a fact’s `evidence` or OKF `sources` points at a concept, open that OKF file for deeper context.  
3. Do not treat an OKF folder alone as production policy.  
4. New org claims from OKF go through `uni import-okf` → review → `uni publish`.

## Library

- `src/okf.ts` — map, serialize, parse, propose payloads  
- Tests: `src/okf.test.ts`

## Related

- [Frameworks](frameworks.md)  
- [M365 `@Uni`](integrations/m365-copilot.md)  
- [Google Workspace `@Uni`](integrations/google-workspace.md)  
- [Provenance](enterprise-readiness.md)  
- **Product UI plan (unifact.ai):** see companion app repo `dahg-ai` → `docs/okf-ui-plan.md`

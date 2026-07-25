# Health insurance / payer fact registry template

Reusable UniFact pattern pack for **health insurers and health plans (payers)**. Tagline: **One Fact. One Truth.**

Registry namespaces: `patterns.payer.core`, `patterns.payer.operations` (lookup baselines). Customer registries use `payer.*` plus `company.*`.

**Industry term:** *payer* = the organization that pays for care (health plan / insurer), vs *provider* (delivers care). Public copy may say **health insurer / health plan**; technical namespace stays `patterns.payer`.

**Illustrative buyer shape:** national health plan (e.g. Cigna-style). Not a claimed UniFact customer unless they onboard.

Public SEO page: [unifact.ai/packs/health-insurance-payer](https://unifact.ai/packs/health-insurance-payer)

---

## Why payers fit UniFact

| Pain | UniFact answer |
|------|----------------|
| Agents invent coverage or medical necessity | Constraint facts block invention; escalate to UM / SoR |
| Medical policy buried in PDFs | Publish keyed summaries agents must cite |
| Claims / appeals tribal knowledge | Escalation and timeline patterns as facts |
| HIPAA risk in chat “memory” | Hard rule: **no PHI / claim payloads** in the registry |

**Not a fit for:** eligibility files, EOBs with identifiers, claim adjudication engines, or automated coverage determinations that replace UM.

---

## Architecture (usually one registry)

```
{OrgRegistry}/
├── company.branding/
├── company.guidelines/
├── company.decisions/
├── company.constraints/      # phi_not_in_registry, hipaa_boundary
├── payer.medical_policy/
├── payer.coverage/
├── payer.claims_ops/
├── payer.network/
├── payer.appeals/
└── payer.messaging/
```

**Optional lookup:** `patterns.payer.core`, `patterns.payer.operations` — read-only scaffolding; org facts always win.

Multi-registry later if commercial vs Medicare Advantage vs Medicaid need federation.

---

## Starter fact keys

### `payer.medical_policy`
| Key | Purpose |
|-----|---------|
| `medical_policy_summary_keys` | Approved policy summary language |
| `clinical_criteria_citation_pattern` | How agents must cite criteria |
| `policy_review_cadence` | When policies are reviewed |

### `payer.coverage`
| Key | Purpose |
|-----|---------|
| `coverage_determination_sop` | Process — not case outcomes |
| `benefit_exclusion_keys` | Exclusion scaffolding |
| `experimental_treatment_handoff` | Escalation path |

### `payer.claims_ops`
| Key | Purpose |
|-----|---------|
| `claims_adjudication_escalation` | When to escalate |
| `timely_filing_pattern` | Filing window language |
| `provider_dispute_keys` | Dispute handoff |

### `payer.network` / `payer.appeals`
| Key | Purpose |
|-----|---------|
| `provider_network_rules` | Network rules (non-PHI) |
| `out_of_network_exception_pattern` | OON exception SOP |
| `appeals_timelines` | Internal / external timelines |
| `external_review_handoff` | External review path |

### `payer.messaging` / `company.constraints`
| Key | Purpose |
|-----|---------|
| `member_communications_disclaimer` | Safe member copy |
| `agent_must_cite_published_policy` | Citation requirement |
| `what_agent_must_not_answer` | Topics that require human / SoR |
| `phi_not_in_registry` / `hipaa_boundary` | Hard constraints |

---

## What never belongs in UniFact

| Do not store | Why |
|--------------|-----|
| PHI / member clinical records | Wrong system; HIPAA |
| Claim payloads / EOBs with IDs | Claims SoR |
| Invented coverage outcomes | Constraint — escalate to UM |

---

## Pitch flow

1. Discovery — medical policy, UM, claims ops, appeals, member FAQs  
2. Constraint facts first — PHI ban + coverage invention ban  
3. 15–30 starter keys from tables above  
4. Member/provider agents cite published policy only  
5. Review cadence — medical policy / compliance publishes; supersede on change  

**Entry:** [unifact.ai/enterprise](https://unifact.ai/enterprise) · [unifact.ai/packs/health-insurance-payer](https://unifact.ai/packs/health-insurance-payer)

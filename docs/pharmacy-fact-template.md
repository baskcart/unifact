# Pharmacy / PBM fact registry template

Reusable UniFact pattern pack for **pharmacy, PBM, and retail health** operations. Tagline: **One Fact. One Truth.**

Registry namespaces: `patterns.pharmacy.core`, `patterns.pharmacy.operations` (lookup baselines). Customer registries use `pharmacy.*` plus `company.*`.

**Illustrative buyer shape:** large pharmacy/PBM (e.g. CVS Health–style). Not a claimed UniFact customer unless they onboard.

Public SEO page: [unifact.ai/packs/pharmacy-pbm](https://unifact.ai/packs/pharmacy-pbm)

---

## Why pharmacy / PBM fits UniFact

| Pain | UniFact answer |
|------|----------------|
| Agents invent dosing, interactions, or PA outcomes | Constraint facts block invention; escalate to licensed staff / SoR |
| Formulary & PA rules live in tribal docs | Publish keyed patterns agents must cite |
| HIPAA / PHI risk in “knowledge bases” | Hard rule: **no PHI** in the registry |
| Member chat drifts from approved copy | `pharmacy.messaging` holds disclaimers only |

**Not a fit for:** prescription fills, claim payloads, controlled-substance ledgers, or clinical decision support that replaces a licensed pharmacist.

---

## Architecture (usually one registry)

```
{OrgRegistry}/
├── company.branding/
├── company.guidelines/
├── company.decisions/
├── company.constraints/     # phi_not_in_registry, hipaa_boundary
├── pharmacy.formulary/
├── pharmacy.prior_auth/
├── pharmacy.dispensing/
├── pharmacy.network/
└── pharmacy.messaging/
```

**Optional lookup:** `patterns.pharmacy.core`, `patterns.pharmacy.operations` — read-only scaffolding; org facts always win.

---

## Starter fact keys

### `pharmacy.formulary`
| Key | Purpose |
|-----|---------|
| `formulary_tiers_pattern` | Tier language agents may use |
| `preferred_drug_list_keys` | Preferred vs non-preferred scaffolding |
| `exclusion_list_keys` | What is out of formulary (non-PHI) |
| `quantity_limit_pattern` | QL / day-supply pattern language |

### `pharmacy.prior_auth`
| Key | Purpose |
|-----|---------|
| `prior_auth_criteria_summary` | Non-clinical summary of when PA applies |
| `prior_auth_sla_pattern` | Turnaround expectations |
| `appeal_handoff_keys` | Where to send appeals |

### `pharmacy.dispensing`
| Key | Purpose |
|-----|---------|
| `dispensing_exception_pattern` | Exception SOP (no member data) |
| `specialty_pharmacy_handoff` | Specialty routing rules |
| `controlled_substance_sop_keys` | Process keys only — not inventory |

### `pharmacy.network`
| Key | Purpose |
|-----|---------|
| `network_pharmacy_rules` | In-network rules |
| `out_of_network_escalation` | OON handoff |

### `pharmacy.messaging` / `company.constraints`
| Key | Purpose |
|-----|---------|
| `member_communications_disclaimer` | Safe member copy |
| `agent_must_not_invent_clinical_advice` | Blocks clinical invention |
| `what_agent_must_cite` | Required citations |
| `phi_not_in_registry` / `hipaa_boundary` | Hard constraints |

---

## What never belongs in UniFact

| Do not store | Why |
|--------------|-----|
| PHI / Rx fills / member IDs with clinical data | Wrong system; HIPAA |
| Claim payloads | Adjudication SoR |
| Invented clinical advice | Constraint — escalate |

---

## Pitch flow

1. Discovery — formulary, PA, specialty, member FAQs, HIPAA posture  
2. Constraint facts first — PHI ban + clinical invention ban  
3. 15–30 starter keys from tables above  
4. Member/agent messaging from published facts only  
5. Review cadence — pharmacy ops / compliance publishes; supersede on policy change  

**Entry:** [unifact.ai/enterprise](https://unifact.ai/enterprise) · [unifact.ai/packs/pharmacy-pbm](https://unifact.ai/packs/pharmacy-pbm)

# Enterprise composition maps (staging seed design)

Concrete **registry + namespace + fact-pack lookup** layouts for:

1. **Acme Bank** — five business units that could each stand alone  
2. **X Group** — Cursor + xAI after acquisition (compose), with a clean split path  

These are **staging design artifacts**. Production attaches only licensed, published packs and entitlements.

**Rules applied**

- **Registry** = write / membership boundary  
- **Namespace** = topic folder (dotted hierarchy; parents implicit)  
- **Lookup** = published, read-only; never grants write or push  
- Platform packs live under platform registry namespaces `industry.*` (example owner: `Unifact`)  
- Customer writable truth stays in the customer registry  

Tagline: **One Fact. One Truth.** — composition via lookup, not copy-paste of packs.

---

## Shared platform packs (staging catalog)

Publish these under the platform registry (e.g. `Unifact`) as **org-public** namespaces so any training/enterprise registry can `lookup add`.

| Namespace | Vertical / domain | Example fact keys (illustrative) |
|-----------|-------------------|----------------------------------|
| `industry.banking.retail` | Retail banking CX / ops baseline | `kyc_customer_questions`, `branch_hours_pattern` |
| `industry.capital_markets.derivatives` | Derivatives trading | `margin_call_escalation_pattern`, `trade_confirm_sla_pattern` |
| `industry.capital_markets.equities` | Equity / stock trading | `settlement_t2_pattern`, `order_type_glossary` |
| `industry.private_equity` | PE / alternatives | `fund_raise_stages`, `lp_reporting_cadence_pattern` |
| `industry.wealth` | Wealth / private bank | `suitability_questions`, `ips_review_cadence_pattern` |
| `industry.banking.risk_baseline` | Cross-BU risk language | `escalation_severity_levels`, `incident_notify_window_pattern` |
| `industry.devtools.saas` | Devtools / SaaS product | `sla_support_tiers_pattern`, `data_retention_questions` |
| `industry.ai_research` | AI research lab | `model_eval_gate_pattern`, `safety_review_checklist` |
| `industry.cloud_ai` | Cloud AI platform | `quota_fair_use_pattern`, `region_availability_questions` |

Pack facts must be **patterns / scaffolding**, not firm-specific rates or legal advice. Firm answers are published in the customer home namespace.

---

## Map 1 — Acme Bank (five BUs)

### Registries

| Registry | Role | Members write? |
|----------|------|----------------|
| `AcmeBank.Group` | Shared corporate standards (brand, security, agent policy) | Group risk / corp only |
| `AcmeBank.Retail` | Retail banking BU | Retail ops + product |
| `AcmeBank.Derivatives` | Derivatives trading | Desk + BU compliance |
| `AcmeBank.Equities` | Stock / equity trading | Desk + BU compliance |
| `AcmeBank.PrivateEquity` | Private equity | Deal team + BU counsel |
| `AcmeBank.Wealth` | Wealth management | Advisors + BU compliance |

### Namespaces (writable home truth)

**`AcmeBank.Group`**

| Namespace | Purpose | Org-public? |
|-----------|---------|-------------|
| `company.guidelines` | Bank-wide agent and employee rules | **Yes** (BUs look this up) |
| `company.branding` | Legal names, public brand strings | **Yes** |
| `company.security` | Baseline security / data handling | **Yes** (curated) |
| `company.decisions` | Internal group decisions | No |
| `company.infrastructure` | Hosts, keys pointers (non-secret) | No |

**`AcmeBank.Derivatives`** (other BUs mirror this shape)

| Namespace | Purpose |
|-----------|---------|
| `company.guidelines` | BU-local overrides / desk rules (optional; prefer `trading.*`) |
| `trading.derivatives.policy` | Desk policies, escalation owners |
| `trading.derivatives.products` | Products offered, hours, contact facts |
| `trading.derivatives.compliance` | BU-specific compliance assertions |
| `trading.derivatives.clients` | Account-specific exceptions (e.g. Client X terms) |

**`AcmeBank.Equities`** → `trading.equities.*`  
**`AcmeBank.PrivateEquity`** → `pe.fund.*`, `pe.lp.*`  
**`AcmeBank.Retail`** → `retail.branch.*`, `retail.products.*`  
**`AcmeBank.Wealth`** → `wealth.advisory.*`, `wealth.products.*`

### Lookups (compose packs + group)

| From registry | Lookup target | Why |
|---------------|---------------|-----|
| Each BU | `Unifact/industry.banking.risk_baseline` | Shared risk language |
| `AcmeBank.Retail` | `Unifact/industry.banking.retail` | Vertical pack |
| `AcmeBank.Derivatives` | `Unifact/industry.capital_markets.derivatives` | Vertical pack |
| `AcmeBank.Equities` | `Unifact/industry.capital_markets.equities` | Vertical pack |
| `AcmeBank.PrivateEquity` | `Unifact/industry.private_equity` | Vertical pack |
| `AcmeBank.Wealth` | `Unifact/industry.wealth` | Vertical pack |
| Each BU | `AcmeBank.Group/company.guidelines` | Group standards |
| Each BU | `AcmeBank.Group/company.branding` | Shared brand |
| Each BU | `AcmeBank.Group/company.security` | Shared security baseline |

CLI shape (staging):

```bash
# On AcmeBank.Derivatives (after uni use <person> in that registry)
uni lookup add trading.derivatives.policy Unifact/industry.capital_markets.derivatives
uni lookup add trading.derivatives.policy Unifact/industry.banking.risk_baseline
uni lookup add trading.derivatives.policy AcmeBank.Group/company.guidelines
```

(Exact “from namespace” is the local ns that should resolve through the lookup path; follow product CLI docs for `lookup add`.)

### Resolution example (Derivatives desk agent)

1. `AcmeBank.Derivatives` / `trading.derivatives.policy` (home — writable)  
2. Parent namespaces under that hierarchy  
3. Lookups: industry derivatives pack → risk baseline → Group guidelines  

Firm-published “Client X margin terms” always beat pack patterns.

### Compose (larger bank)

- Add a sixth BU registry + industry pack lookup + Group lookups.  
- Or attach an extra cross-cutting pack (e.g. AML baseline) to all BUs.

### Split (PE becomes independent)

1. Keep registry `AcmeBank.PrivateEquity` (rename to `AcmePE` if desired).  
2. `lookup remove` Group targets (or leave during TSA).  
3. Keep `Unifact/industry.private_equity`.  
4. Re-issue owners/API keys; no pack rewrite.

---

## Map 2 — X acquires Cursor and xAI

### Day 0 — before deal (two companies)

| Registry | Writable namespaces (examples) | Pack lookups |
|----------|--------------------------------|--------------|
| `Cursor` | `company.guidelines`, `product.ide.*`, `product.pricing.*` | `Unifact/industry.devtools.saas` |
| `xAI` | `company.guidelines`, `research.models.*`, `product.api.*` | `Unifact/industry.ai_research`, `Unifact/industry.cloud_ai` |

### Day 1 — compose into one larger organization (no forced merge)

| Registry | Role |
|----------|------|
| `X.Group` | Holding / shared published standards |
| `Cursor` | Remains product tenancy (write boundary) |
| `xAI` | Remains research / API tenancy |

**`X.Group` namespaces**

| Namespace | Org-public? | Notes |
|-----------|-------------|--------|
| `company.guidelines` | **Yes** | Shared agent policy, security, “how we work” |
| `company.branding` | **Yes** | Group brand; product brands may stay in child registries |
| `company.security` | **Yes** | Baseline for all subsidiaries |
| `company.decisions` | No | Integration decisions, private |
| `m_and_a.integration` | No | Cutover checklist facts |

**Lookups after acquisition**

| Registry | Add lookup |
|----------|------------|
| `Cursor` | `X.Group/company.guidelines`, `X.Group/company.security`, `X.Group/company.branding` |
| `xAI` | same Group targets |
| `Cursor` | keep `Unifact/industry.devtools.saas` |
| `xAI` | keep `Unifact/industry.ai_research`, `Unifact/industry.cloud_ai` |

Optional later: `Cursor` looks up a **curated org-public** subset of `xAI/company.guidelines` (only what Group approved for cross-read) — still read-only.

### Why not merge registries on day 1

- Different risk owners, roadmaps, and possible future spin-out.  
- Agents get “one org” via **Group lookup** immediately.  
- Writable facts stay where the teams already publish.

### Full absorb (optional, later)

If X wants a single write tenancy:

1. Create namespaces under `X` or `Cursor` for former xAI topics (`research.models.*`, …).  
2. Migrate **published** xAI facts (export / re-propose / publish).  
3. Point agents at the surviving registry.  
4. Retire `xAI` registry membership.  
5. Packs remain lookups on the survivor.

### Split / unwind

| Event | Action |
|-------|--------|
| xAI spun out | Remove `X.Group` lookups from `xAI`; keep industry packs; new owners |
| Cursor sold | Same for `Cursor` |
| Group dissolved | Remove Group lookups; subsidiaries already complete |

---

## Staging seed checklist

### Platform (`Unifact`)

- [ ] Create/publish org-public `industry.*` namespaces listed above (start with 3–5 packs).  
- [ ] Seed 15–40 pattern facts per pack; mark scope as industry-default in descriptions.  
- [ ] Do **not** org-public `company.infrastructure` or secret material.

### Acme Bank pilot

- [ ] Create 6 registries: Group + 5 BUs.  
- [ ] Seed Group `company.guidelines` / `branding` / `security` (org-public).  
- [ ] Seed one sample writable fact per BU home namespace.  
- [ ] Wire lookups per table above.  
- [ ] Demo agent Fact Check on Derivatives: home → pack → Group.

### X / Cursor / xAI pilot

- [ ] Create `Cursor`, `xAI`, then `X.Group`.  
- [ ] Publish Group guidelines org-public.  
- [ ] Add Group lookups on Cursor and xAI.  
- [ ] Demo: same security baseline fact resolved via lookup in both product registries.  
- [ ] Demo split: remove Group lookup from xAI; confirm product facts still resolve.

---

## Pricing hook (production only)

| Entitlement | Staging | Production |
|-------------|---------|------------|
| Platform registries | Pilot free | Enterprise platform fee |
| Industry packs | All staging packs available | Licensed per pack / suite |
| Group composition | Unlimited in pilot | Included in platform |
| Private / co-branded pack | Optional services | Premium SKU |

Entitlement in production = which `lookup add` targets a registry is allowed to attach.

---

## Quick reference — compose vs split

| Goal | Mechanism |
|------|-----------|
| Larger organization | New/keep Group registry; org-public shared ns; subsidiaries **lookup** |
| More BU independence | BU **registry** + industry pack; optional Group lookup |
| Add vertical knowledge | `lookup add` industry pack |
| Remove vertical | `lookup remove` |
| Spin out / sell BU | Detach Group lookups; keep registry + packs |
| M&A day-one unity | Group lookup — avoid forced fact migration |

---

*Document status: staging design. Promote pack namespaces and pilot layouts to production only after review/publish and commercial entitlement.*

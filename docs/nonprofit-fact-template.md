# Nonprofit fact registry template (pitch + onboarding)

Reusable template for offering UniFact to small and mid-size nonprofits. Use this when pitching; adapt namespaces and keys to the org’s programs. **Illustrative example only** at the end (Prepared Futures Foundation-style Child ID program — not a UniFact customer unless they onboard).

Tagline: **One Fact. One Truth.** — volunteers, staff, and agents share the same governed answers.

---

## Why nonprofits fit UniFact

| Pain | UniFact answer |
|------|----------------|
| Volunteer turnover | Event SOPs and approved messaging survive rotation |
| High trust / sensitive missions | Privacy and “what we do **not** do” are **constraint facts**, not buried in PDFs |
| Small team, no Confluence cycle | One registry + service agent (`/build`) beats doc search |
| Public questions (“Do you keep my child’s data?”) | Governed FAQ; agents must not invent retention policy |

**Not a fit for:** storing beneficiary PII, donor CRM replacement, or grant accounting ledgers. UniFact governs **operational and public truth**, not transactional databases.

---

## Architecture (usually one registry)

Unlike enterprise bank composition, most nonprofits start with **one registry** and a few program namespaces. Optional later: lookup to a platform **nonprofit pattern pack** (`patterns.nonprofit.*` on the UniFact registry).

```
{OrgRegistry}/
├── company.branding/          # Legal name, DBA, public tagline
├── company.guidelines/        # Volunteer + agent rules (org-public where safe)
├── company.decisions/         # Board/exec decisions (often not org-public)
├── programs.{program}.privacy/    # Non-negotiable data-handling constraints
├── programs.{program}.events/     # SOPs, roles, checklists
├── programs.{program}.messaging/  # Approved public copy + citations
└── fundraising.grants/        # Optional: grant language, reporting cadence
```

**Lookup (optional):** `patterns.nonprofit.volunteer_programs`, `patterns.nonprofit.youth_safety` — read-only scaffolding; org facts always win.

---

## Generic fact keys (copy into customer registry)

Replace `{program}` with slug (e.g. `child_id`, `food_pantry`, `mentoring`).

### `company.branding`

| Key | Example value shape | Notes |
|-----|---------------------|-------|
| `legal_name` | `"Example Foundation Inc."` | IRS / state filing name |
| `public_name` | `"Example Foundation"` | Website / events |
| `mission_statement` | One sentence | Board-approved |
| `geographic_scope` | `"El Paso County, Colorado"` | Where services operate |
| `ein` | Optional | Org-public only if intentional |

### `programs.{program}.privacy` (constraints — publish early)

| Key | Purpose |
|-----|---------|
| `data_retention_policy` | What the org keeps, for how long, or **none** |
| `beneficiary_record_handoff` | Who receives records (e.g. family only) |
| `no_org_database_of_{subject}` | Explicit negative capability |
| `volunteer_device_rules` | No personal phones for capture, etc. |
| `third_party_sharing` | Who does **not** get copies by default |

### `programs.{program}.events`

| Key | Purpose |
|-----|---------|
| `event_types` | Recurring vs one-off |
| `volunteer_roles` | Greeter, operator, handoff, teardown |
| `pre_event_checklist` | Equipment, signage, consent |
| `guardian_presence_required` | Eligibility |
| `equipment_list` | Specialized gear + maintenance cadence |
| `incident_escalation` | On-site incident vs external referral |

### `programs.{program}.messaging`

| Key | Purpose |
|-----|---------|
| `program_summary_public` | Website / chat safe |
| `what_program_is_not` | Disclaimers (does not prevent X, does not guarantee Y) |
| `statistics_citations` | Source, year, exact wording allowed |
| `referral_contacts` | NCMEC, local LE, crisis lines — **public** numbers only |

### `company.guidelines`

| Key | Purpose |
|-----|---------|
| `volunteer_code_of_conduct` | Short, agent-safe summary |
| `agent_must_not_invent` | List topics agents require facts for |
| `media_and_photo_policy` | Especially for youth programs |

---

## What never belongs in UniFact

| Do not store | Why |
|--------------|-----|
| Beneficiary PII (names, photos, fingerprints, addresses) | Wrong system; consent and retention differ |
| Event attendee lists | Use ephemeral capture workflow; delete per policy |
| Donor PII / payment details | CRM / processor of record |
| Unapproved legal advice | Only board/counsel-approved **assertions** as facts |

If capture software is used on-site, it should be **ephemeral** (capture → print/handoff → delete). UniFact holds the **policy that deletion happens**, not the deleted data.

---

## Pitch flow (B — template you offer)

1. **Discovery** — Programs, volunteers, public questions, privacy sensitivities.
2. **Namespace sketch** — 15–30 starter keys from tables above (not 500 facts).
3. **Constraint facts first** — Privacy and “what we don’t do” before marketing copy.
4. **Service agent** — Parent/public FAQ from published facts (`/build` or hosted agent).
5. **Work agent (optional)** — Volunteer/staff MCP with read-only access to SOP facts.
6. **Review cadence** — Board or program lead approves publish; supersede when policy changes.

**Entry points:** [unifact.ai/build](https://unifact.ai/build) (small team) → enterprise path if multi-program or federation later.

---

## Platform pattern pack (generic — UniFact registry)

Published under `patterns.nonprofit.*` (proposed staging). Customers **lookup**; they do not edit the pack. Their home namespace overrides.

| Namespace | Contents |
|-----------|----------|
| `patterns.nonprofit.core` | Template overview, namespace layout, pitch checklist |
| `patterns.nonprofit.volunteer_programs` | Generic volunteer/event/messaging keys |
| `patterns.nonprofit.youth_safety` | Extra privacy constraints for youth-serving orgs |

See MCP facts `patterns.nonprofit/*` (proposed until reviewed).

---

## Example instantiation (illustrative only)

**Prepared Futures Foundation** (working name, Colorado, Child ID events) — example from external plan, **not** a UniFact customer.

| Namespace | Example keys to fill when they onboard |
|-----------|----------------------------------------|
| `programs.child_id.privacy` | `no_org_database_of_children`, `record_handoff_to_guardian_only`, `delete_immediately_after_handoff` |
| `programs.child_id.events` | `recurring_countywide_events`, `volunteer_roles`, `equipment_list` |
| `programs.child_id.messaging` | `ncmec_statistics_2025`, `disclaimer_not_prevention`, `community_gap_el_paso_county` |
| `company.branding` | `mission_pillars`, `geographic_scope` |

**Sample constraint facts (wording for their board to approve):**

- `programs.child_id.privacy/no_org_database_of_children` — The organization does not retain child identifying information or maintain a database of children served.
- `programs.child_id.privacy/record_handoff_to_guardian_only` — The completed identification record is provided only to the parent or legal guardian present at the event.
- `programs.child_id.privacy/delete_immediately_after_handoff` — Digital copies used to produce the record are deleted from event systems immediately after handoff.
- `programs.child_id.messaging/disclaimer_not_prevention` — A Child ID record helps families organize accurate information when time matters; it does not prevent a child from going missing or guarantee recovery.

**Sample citation fact (must include source + year):**

- `programs.child_id.messaging/ncmec_missing_child_cases_2025` — NCMEC supported 32,167 missing-child cases in 2025, including 553 reported from Colorado. Source: National Center for Missing & Exploited Children (cite exact publication when board approves).

---

## Onboarding checklist (facilitator / sales)

- [ ] Registry created; executive sponsor assigned
- [ ] Privacy constraint facts drafted and **legally reviewed**
- [ ] No beneficiary PII in registry (explicit team rule)
- [ ] 10–20 operational facts published before turning on public agent
- [ ] Service agent tested with “worst case” questions (retention, law enforcement, guarantees)
- [ ] Volunteer-facing facts separated from internal `company.decisions`
- [ ] Supersede process when board updates policy

---

## Related docs

- [Enterprise composition maps](./enterprise-composition-maps.md) — contrast for multi-BU / pack lookups
- [Config as facts](./config-as-facts.md) — non-secret config in namespaces
- [Training sandbox](./training/README.md) — lab registries for demos

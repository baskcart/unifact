# UniFact — NJ AI Hub Accelerator Pitch Deck (Batch 2)

**Audience:** Plug and Play / NJ AI Hub (pilots, mentorship, corporate intros — not a raise pitch)  
**Stage:** MVP live · Product company (SaaS) · Optional paid onboarding, not an AI consultancy  
**Brand:** UniFact · tagline *One Fact. One Truth.* · https://unifact.ai  
**Apply by:** Friday, July 17, 2026  

**Design notes:** Dark ground `#0a0a1a`; mark gradient `#8b5cf6 → #4f46e5 → #10b981`. Use locked logo (SVG). Say **Uni Facts** for registry entries; product name **UniFact**; default chat agent **Uni**. Do not mention Ta Dah as UniFact’s parent or studio.

**Placeholders:** Replace `[FOUNDER NAME]`, `[ROLE]`, and any bracketed items before submit.

---

## Slide 1 — Title

**UniFact**  
One Fact. One Truth.

Organizational truth for AI agents  
https://unifact.ai

NJ AI Hub Accelerator · Batch 2 Application  
MVP live

*Footer:* West Windsor–accessible · New Jersey AI ecosystem

---

## Slide 2 — The problem

**Agents are shipping. Organizational truth is not.**

Companies now run coding agents, ops assistants, and customer chatbots side by side.

Each one is fed from different sources: READMEs, wikis, Slack, outdated PDFs, tribal knowledge.

**Result:** conflicting answers, repeated corrections, and actions taken on stale or unauthorized “facts.”

One-line punch: *AI fails organizations not only because models are wrong — because the organization has no single, governed truth layer agents can trust.*

---

## Slide 3 — Why now

**Work agents entered the mainstream.**

Teams already use Cursor, Claude, Codex, and similar shells in daily shipping work.

Those agents lack a **shared, reviewable registry** of what the company has decided is true — brand, policy, infra, product rules, customer commitments.

Vector RAG and prompt stuffing help retrieve text. They do not give you **propose → review → publish → pull** with audit history.

**Window:** own the “org truth” layer before every vendor bolts a private memory silo onto their agent.

---

## Slide 4 — Solution

**UniFact is the organizational fact registry.**

One place for authoritative Uni Facts — with a lifecycle agents understand:

1. **Propose** — builders and agents suggest facts  
2. **Review** — curators approve or reject  
3. **Publish** — production truth  
4. **Pull** — agents Fact Check before they act  

Tagline on slide: **One Fact. One Truth.**

Not a data warehouse. Not another wiki. The **governance layer between humans, documents, and agents.**

---

## Slide 5 — Product

**What buyers get**

| Capability | What it does |
|---|---|
| **Fact registry** | Namespaced Uni Facts with versioning, supersede, retract |
| **Work-agent MCP** | Fact Check in Cursor / Claude / Codex-class tools |
| **Publish workflow** | Propose → review → publish (Git-like for truth) |
| **Customer agents** | Ground chatbots in *published* facts (white-label; default: Uni) |
| **Sync** | Local working store + cloud origin registry |

**Live surface:** https://unifact.ai  
Self-serve path: GitHub OAuth to create an org registry.

---

## Slide 6 — Demo / traction

**Proof today (MVP)**

- Live product at **unifact.ai**  
- Used as the **operating truth layer** for the UniFact org itself (agents must Fact Check before org-dependent work)  
- MCP + CLI for work agents; registry lifecycle in production use  

**Optional visual:** 20–30s clip of Fact Check → publish → agent behavior change (use the cleaned founder video if attached).

**Honest framing for Hub:** Strong product & dogfooding; seeking **design partners and enterprise pilots** to harden GTM — which is why the accelerator fits.

---

## Slide 7 — Market fit (Hub lenses)

**Plug and Play / NJ AI Hub focus areas we map to:**

1. **Future of Work** — shared truth for employee/work agents so AI labor is reliable  
2. **Big Data + AI** — trusted context layer for agentic systems (authority, not bulk storage)  
3. **Customer Engagement** — customer-facing agents grounded in published Uni Facts only  

**NJ angle:** Regulated and knowledge-heavy industries (pharma, finance, telecom, public sector adjacency) need **auditable agent context** — propose/review/publish beats “stuff the prompt.”

---

## Slide 8 — Who buys

**Primary ICP (first 12 months)**

Teams already deploying AI work agents who keep re-explaining:

- brand and naming rules  
- infrastructure and hosting policy  
- product decisions and constraints  
- support/policy answers that must not drift  

**Buyer personas**

- Founder / CTO of AI-adopting SMB or product org  
- Platform / DevEx lead wiring agents into the SDLC  
- Ops / knowledge owner tired of agents inventing policy  

**Land:** one org registry + MCP wired into daily agent work  
**Expand:** more agents, more namespaces, curator seats, customer-agent deployments

---

## Slide 9 — Business model

**Product company. SaaS first.**

| Layer | Offer |
|---|---|
| **Core** | Org / seat / usage subscription for the registry |
| **Onboarding (optional)** | Fixed-scope “Agent Truth Launch” — seed Uni Facts, wire MCP, set curator workflow |
| **Not this** | Open-ended AI consulting firm |

Implementation packages **fund early learning and design partners**. The narrative and roadmap stay **product-led**.

*(No invented ARR / pricing on this slide until you lock list prices — Hub will accept “pricing in validation.”)*

---

## Slide 10 — Why NJ AI Hub

**What we want from the accelerator (the ask)**

- **Enterprise & university pilots** through Hub / Plug and Play network  
- **Mentorship** on commercialization and ICP sharpening  
- **Visibility** in NJ’s AI ecosystem (West Windsor coworking during program)  
- **Pathways** to corporates who need trustworthy agent operations  

Zero equity / no tied funding is a fit: we need **distribution and pilots**, not a pitched valuation story.

**In return:** a live MVP in **Future of Work / agent infrastructure**, ready to run design-partner pilots during Batch 2 (Sep–Dec 2026).

---

## Slide 11 — Roadmap (12 months)

| Horizon | Focus |
|---|---|
| **Now → 90 days** | Close design partners; tighten onboarding; polish self-serve org creation |
| **6 months** | Multi-org patterns; stronger curator UX; pilot case studies |
| **12 months** | Enterprise readiness (SSO beyond GitHub, compliance narratives); scale seats |

Technical foundation already chosen: local SQLite working store + PostgreSQL origin registry; cloud-neutral upstream sync.

---

## Slide 12 — Team + ask

**Team**

| Name | Role |
|---|---|
| `[FOUNDER NAME]` | Founder · product & platform |
| `[COFOUNDER / ADVISOR if any]` | `[ROLE]` |

*Add one line of relevant background each (AI/systems/startup). Leave blank rows if solo for now — Hub accepts MVP teams.*

**The ask**

Admit UniFact to **NJ AI Hub Accelerator Batch 2** to:

1. Win **2–3 design-partner pilots**  
2. Access mentorship and corporate intros for **agent-ops / Future of Work** buyers  
3. Use Hub workspace and community to ship commercialization milestones by Dec 2026 Expo  

**Contact:** `[EMAIL]` · https://unifact.ai

---

## Optional appendix (only if the portal allows extra slides)

### A — Competitive positioning (one slide)

| Alternative | Gap |
|---|---|
| Wikis / Notion / Confluence | Human docs; agents don’t Fact Check a governed publish layer |
| Vector RAG / “memory” | Retrieval ≠ authority; weak review, supersede, audit |
| Custom prompt stuffing | Fragile, unshared across agents |
| **UniFact** | Registry + lifecycle + MCP pull for universal agents |

### B — How a Fact Check works (one slide)

Work agent starts task → `sync_pull` / search Uni Facts → acts only on **published** truth → proposes updates when discovery happens → curator publishes.

---

## Speaker cheat sheet (60–90 seconds)

> Companies are deploying AI agents faster than they are governing what those agents are allowed to believe. UniFact is the organizational fact registry — One Fact. One Truth. Agents Fact Check via MCP; humans propose, review, and publish. We’re live at unifact.ai, dogfooding the product, and applying to the Hub for design partners and enterprise pilots — not to become a consulting shop, but to productize trustworthy agent context.

---

## Pre-submit checklist

- [ ] Fill `[FOUNDER NAME]`, `[EMAIL]`, team bios  
- [ ] Attach logo + optional 20–30s demo clip  
- [ ] Confirm any legal entity / NJ location language with founder (none asserted in UniFact registry yet)  
- [ ] Export to PDF or PPTX for the Hub application form  
- [ ] Apply: https://njaihub.org/ (Batch 2 · deadline **July 17, 2026**)

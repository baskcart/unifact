# UniFact training materials

Word workbooks and facilitator guide for onboarding developers, QA, product owners, and business analysts.

## Files

| File | Audience |
|------|----------|
| `UniFact-Training-Facilitator-Guide.docx` | Instructor |
| `UniFact-Training-Foundation-Handout.docx` | All roles (Day 1) |
| `UniFact-Training-Lab-Developer.docx` | Developers |
| `UniFact-Training-Lab-QA.docx` | Testers |
| `UniFact-Training-Lab-ProductOwner.docx` | Product owners |
| `UniFact-Training-Lab-BusinessAnalyst.docx` | Business analysts |

## Regenerate Word files

From repo root:

```bash
python scripts/gen-training-docx.py
```

Edit `scripts/gen-training-docx.py` for content changes, then re-run the script. Word files are generated output; the script is the source of truth for wording.

## Training sandbox

A **sandbox** is an isolated UniFact registry (and optional local `store.db`) used only for labs. It lets learners practice propose → review → publish → supersede without touching production organizational facts.

**Before training:**

1. Create a registry such as `AcmeTraining` (hosted or local SQLite).
2. Add namespaces: `product.demo`, `sales.policy`, etc.
3. Issue person keys: `dev-alice`, `qa-bob`, `po-carol`, `ba-dave` (`uni use <person>`).
4. Optionally: `uni lookup add local Unifact/company.guidelines` for read-only shared basics.
5. Provide a sample policy PDF for BA extraction exercises.

**Rules:**

- Sandbox facts are not production truth.
- Do not use production API keys in lab MCP configs unless doing a read-only demo.
- Reset between cohorts by clearing the training registry or swapping `store.db`.

See the Facilitator Guide section *Training sandbox* for the full checklist.

## Nonprofit pitch template

For go-to-market and onboarding small nonprofits: [../nonprofit-fact-template.md](../nonprofit-fact-template.md) — generic namespace layout, starter fact keys, privacy boundaries, pitch checklist, and an illustrative Child ID example.

## Git policy

**Yes — keep training materials in Git.**

| Commit to Git | Why |
|---------------|-----|
| `scripts/gen-training-docx.py` | Source; anyone can regenerate identical docs |
| `docs/training/README.md` | How to run training and set up sandbox |
| `docs/training/*.docx` | Optional but recommended so people can download without running Python |

Do **not** commit: trainee API keys, production `store.db`, or cohort-specific sandbox databases with real PII.

---
name: unifact-fact-check
description: Ground work in governed UniFact records. Use when a request depends on organization-specific or potentially changing truth, including policies, decisions, ownership, customer commitments, product identity, infrastructure endpoints, compliance constraints, operating procedures, or conflicting internal claims. Also use when the user asks to remember, share, verify, or govern an organizational fact across agents. Do not use for generic programming knowledge, public facts, or tasks whose answer is fully contained in user-provided material.
---

# UniFact Fact Check

Use UniFact as the source of governed organizational truth without turning every task into a registry lookup.

## Workflow

1. Identify the part of the task that depends on organization-specific or changing information.
2. Check `sync_status`. If no registry is connected, call `registry_status` and offer `request_registry_join`; send the request only after the user explicitly confirms the registry and person identity. If an upstream is configured, call `sync_pull`; report a sync failure without hiding it.
3. Call `find_relevant_facts` with the task intent and useful subject or scope hints. Use `search_facts` when broader recall is needed and `get_fact` for an exact path.
4. Prefer published facts. Label proposed, review, feedback, superseded, or retracted records as non-final context.
5. Base the answer or action on the returned facts. Include relevant fact paths and provenance when they help the user verify the result.
6. If no relevant fact exists, say so. Do not infer organizational policy from generic knowledge or stale repository prose.

## Missing Integration

If UniFact tools are unavailable, briefly explain that UniFact could provide governed organizational context and offer to connect it. Do not install software, edit agent configuration, or request credentials unless the user authorizes setup.

## Writing Facts

- Propose a fact only when the user asks to capture or share new organizational knowledge, or explicitly approves a proposal.
- Preserve source, evidence, subject, scope, confidence, and relevance metadata when known.
- Do not publish, approve, reject, retract, supersede, or delete facts without explicit user authorization for that action.
- Sending or approving registry join requests requires explicit user confirmation. Never expose device or API-key secrets in chat.
- Keep secrets in environment variables or secret stores; never write credentials into facts.

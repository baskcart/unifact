# Config as facts

**Rule:** non-secret configuration is organizational truth → store it in UniFact. Secrets stay in env / secret managers.

This matches existing product decisions (e.g. upstream registry URL as a fact; DB passwords never as facts).

## Split

| Kind | Examples | Where |
|------|----------|--------|
| Bootstrap | Host URL, person API key | Env / MCP `DATABASE_PATH` + key |
| Secret | `AUTH_GITHUB_SECRET`, `AUTH_SECRET`, DB password, PEM material | Env / SSM / Amplify secrets |
| Config fact | `auth-url`, `auth-github-id`, `upstream-registry-url`, brand URLs | `company.infrastructure/*` (published) |

## Suggested keys (`company.infrastructure`)

| Key | Value example | Notes |
|-----|---------------|--------|
| `upstream-registry-url` | `https://staging.unifact.ai` | Already seeded |
| `auth-url` | `https://www.unifact.ai` | Public product / Auth.js `AUTH_URL` |
| `auth-github-id` | OAuth Client ID | Not a password; still treat as org config |
| `auth-github-secret-location` | `AUTH_GITHUB_SECRET in host env` | Pointer only — never the secret |

Apps may Fact Check these at boot and pass into libraries (Auth.js `GitHub({ clientId })`, etc.).

## Amplify / Next.js note

Amplify console env vars must still be echoed into `.env.production` in `amplify.yml` for Next SSR. Prefer **minimizing** that list to secrets + `UNIFACT_URL`, then load the rest from facts (see example).

## Loader sketch

See [`examples/authjs-config-from-facts.ts`](../examples/authjs-config-from-facts.ts) — fetch published infrastructure facts, merge with `process.env` secrets, configure Auth.js. Do not open a PR to Auth.js for UniFact-as-provider; keep the loader in the app or a thin `@unifact/config` helper later.

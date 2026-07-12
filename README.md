# UniFact

**One Fact. One Truth.**

UniFact is source control for organizational facts — a **tenanted fact registry** so people and AI share one governed truth per organization.

## Mental model (like Git, for facts)

| Git | UniFact |
|-----|---------|
| Hosting (GitHub) | Host (`staging.unifact.ai` or self-hosted) |
| Org / repo | **Registry** named by **org** (e.g. `Unifact`) |
| `git init` / create repo | **`uni registry create <org>`** (planned) |
| Clone + credentials | Join registry → person API key |
| `git pull` / `git push` | **`uni pull` / `uni push`** |
| Branch / PR | Channels: working → proposed → review → **published** |

**First person who creates a registry owns it.** Others **join** that org registry; they do not create a second copy of the same org name.

Optional: paste a **GitHub/GitLab URL** only to suggest org/repo metadata (`uni meta <url>`). UniFact reads public hosting APIs — it does **not** run `git` and does **not** treat a git repo as the registry itself.

## Quick start (local)

```bash
git clone https://github.com/baskcart/unifact.git
cd unifact
npm install
npm run build
npm link          # installs `uni` on your PATH
npm run seed      # optional baseline facts
npm run dev       # API on :4110 (SQLite by default)
```

### Person API keys (in the database — not `.env`)

```bash
uni key create --person alice
uni key list
uni key on  --person alice
uni key off --person alice
```

Keys live in the `api_keys` table (one per person, enable/disable).  
`uni pull` / `uni push` use your **enabled** local key automatically.

### Sync with an origin host

1. Local facts (or config) should include upstream URL, e.g. `company.infrastructure/upstream-registry-url` = `http://staging.unifact.ai`
2. Your person key must also exist and be **on** on that origin
3. Then:

```bash
uni status
uni pull
uni push
```

- **pull** — download **published** facts from origin  
- **push** — upload local **working/proposed** facts to origin as proposed (for review)

## CLI

```text
uni status
uni pull [namespaces…]
uni push [namespaces…]
uni key create --person <name> [--namespaces a,b] [--remote]
uni key list
uni key on|off --person <name>
uni meta <git-url>
```

Plain-language guide (everyone, not only developers): [`docs/user-guide.html`](docs/user-guide.html)

```bash
npm run uni -- status   # same CLI without global link
npm run mcp             # MCP stdio server for agents
```

## Storage

| Mode | When |
|------|------|
| **SQLite** | Default local / laptop (`store.db`) |
| **PostgreSQL** | Origin/host when `DATABASE_URL` is set (server only) |

Auth keys are always rows in `api_keys`, never `UNIFACT_MASTER_KEY` / `UNIFACT_API_KEY` env vars.

## Lifecycle

`working` → `proposed` → `review` → `published` (+ supersede / retract)

## Surfaces

- **REST** — facts, review queue, agent profiles, keys, sync  
- **MCP** — agent tools for propose / search / approve / publish  
- **`uni` CLI** — status / pull / push / keys  

## Tenant roadmap

Intended product shape (partially implemented today):

1. **`uni registry create <org>`** — create tenant registry; creator = owner  
2. **Join request** — others ask to join `<org>`; owner approves → person key  
3. Facts and keys scoped to that org registry  

Today on a shared host you still create person keys; explicit **org registry** create/join is next.

## Deploy notes

See `docs/aws-fargate.md` for container-oriented deploy. Staging often runs on Lightsail (Node instance + managed Postgres) with `DATABASE_URL` on the server only.

## Related

| Repo / site | Role |
|-------------|------|
| **This repo** | UniFact registry engine (API, MCP, CLI, storage) |
| [unifact.ai](https://unifact.ai) / dahg-ai | Product UI / AI employee surfaces on trusted facts |

## Positioning

- Not agent orchestration  
- Not RAG-as-the-product  
- **Fact governance** — AI is a primary consumer, not the only one  

AI shouldn't remember everything. It should know where to find the truth.

# UniFact

**One Fact. One Truth.**

UniFact is source control for organizational facts — a **tenanted fact registry** so people and AI share one governed truth per organization.

## Mental model (like Git, for facts)

| Git | UniFact |
|-----|---------|
| Hosting (GitHub) | Host (`staging.unifact.ai` or self-hosted) |
| Org / repo | **Registry** named by **org** (e.g. `Unifact`) |
| `git init` / create repo | **`uni init <Org>`** — create org registry; you become owner |
| Clone + credentials | **`uni join <Org>`** — request membership; owner **`uni approve`** / **`uni suspend`** |
| `git pull` / `git push` | **`uni pull` / `uni push`** |
| Branch / PR | Channels: working → proposed → review → **published** |

**First person who runs `uni init Unifact` owns registry Unifact.** Others **`uni join Unifact`**; the owner approves before they get a key and can pull/push.

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

### Person API keys (advanced)

Keys live in the `api_keys` table. Prefer **membership** commands for access:

```bash
uni approve DemoOrg --person bob --by admin   # grant / unsuspend
uni suspend DemoOrg --person bob --by admin   # pause access
```

Low-level (usually unnecessary):

```bash
uni key create --person alice
uni key list
uni key on  --person alice
uni key off --person alice
```

`uni pull` / `uni push` use your **enabled** local key automatically.

### Sync with an origin host

**Required path (do not skip):**

1. Set upstream URL, e.g. `company.infrastructure/upstream-registry-url` = `http://staging.unifact.ai`
2. Member: `uni join staging.unifact.ai/Unifact --person alice`
3. Owner (on origin): `uni approve Unifact --person alice --by admin` — grants write namespaces (`*`, `company.*`, …) and prints the person key
4. Member installs that **same** key locally:  
   `uni key create --person alice --api-key <printed> --namespaces '*'`
5. Then:

```bash
uni status
uni pull
uni push                         # all allowed namespaces
uni push policy                  # one namespace
uni push policy/feeling_talk     # one fact
uni push policy/feeling_*        # glob
```

Skipping join/approve (or using a key without write scopes) yields **403** on push.

- **pull** — download **published** facts from origin  
- **push** — upload matching local facts (`proposed` / `review` / `feedback` / `published`). No need to re-add published facts.

### Local facts

```bash
uni add "I don't feel talking when there are more people talking"
# → proposed (local agents can use; production cannot yet)

uni publish policy/feeling_talk      # owner → published (production truth)
uni feedback policy/feeling_sleepy   # owner → feedback (comments, not production)
uni push policy/feeling_*            # selective sync to origin
```

| Channel | Local agents | Production agents |
|---------|--------------|-------------------|
| proposed / review / feedback / published | yes | no (published only) |

**Push (shared registry):**
- Owner `uni push` → remote **feedback** (not direct publish)
- Others `uni push` → remote **review**
- Owner `uni publish` only promotes **review** or **feedback** → **published** (two-step)

**Solo registry:** `uni publish` may still promote **proposed** directly.

## CLI

```text
uni status
uni add "<value>" [--key k] [--namespace policy]
uni publish <namespace/key> | publish --all
uni feedback <namespace/key> | feedback --all
uni push [ns | ns/key | ns/pattern*]
uni pull [namespaces…]
uni key create --person <name> [--namespaces a,b] [--api-key uf_…] [--remote]
uni key list
uni approve <Registry> --person <member> --by <owner>
uni suspend <Registry> --person <member> --by <owner>
uni key on|off --person <name>   # advanced; prefer approve/suspend
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

## Tenant registries (implemented)

```bash
uni init Unifact --person admin [--git-url https://github.com/org/repo]
uni join Unifact --person alice
uni approve Unifact --person alice --by admin
uni suspend Unifact --person alice --by admin   # pause
uni approve Unifact --person alice --by admin   # restore
uni registries
uni team Unifact
```

Optional: `uni join staging.unifact.ai/Unifact --person alice` posts the join request to that host.
After the owner approves **on that host**, Alice must install the printed key locally before `uni push` will succeed.

## Deploy

See **[docs/deploy.md](docs/deploy.md)** — run UniFact anywhere (Node or Docker + SQLite or PostgreSQL). Not tied to a specific cloud vendor.

## Related

| Repo / site | Role |
|-------------|------|
| **This repo** | UniFact registry engine (API, MCP, CLI, storage) |
| [unifact.ai](https://unifact.ai) | Product site / SMB + enterprise UI |
| [User guide](docs/user-guide.html) | Plain-language guide for everyone |

## Positioning

- Not agent orchestration  
- Not RAG-as-the-product  
- **Fact governance** — AI is a primary consumer, not the only one  

AI shouldn't remember everything. It should know where to find the truth.

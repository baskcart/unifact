# UniFact

**One Fact. One Truth.**

Source control for organizational facts — one governed truth **per organization**.

## Mental model

| Git | UniFact |
|-----|---------|
| Host / org | Host (`staging.unifact.ai`) + **registry** named by org (e.g. `Unifact`) |
| `git init` | `uni init Unifact` — you become owner |
| Join + access | `uni join` → owner `uni approve` / `uni suspend` |
| `pull` / `push` | `uni pull` / `uni push` |
| Branches / PRs | Channels: proposed → review / feedback → **published** |

Each org has its own facts. You only see registries you own or belong to.

## Quick start

```bash
git clone https://github.com/baskcart/unifact.git
cd unifact
npm install
npm run build
npm link          # installs `uni` on your PATH
npm run seed      # optional sample facts
npm run dev       # API on :4110
```

```bash
uni use admin
uni init Unifact

uni use alice
uni join Unifact

uni use admin
uni approve Unifact alice

uni add "Returns are free within 30 days"
uni facts
uni publish policy/return_window
uni push
uni pull
```

Plain-language guide: [`docs/user-guide.html`](docs/user-guide.html)

## Everyday CLI

```text
uni use <person> | whoami
uni status
uni facts [Registry]
uni team [Registry]
uni init <Registry> | join <Registry> | approve | suspend
uni add "<value>"
uni publish <namespace/key> | feedback <namespace/key>
uni pull | push [ns | ns/key | pattern*]
```

## Shared host

1. Point at the host (upstream URL fact, or your team’s usual setup).
2. Join the org; owner approves and shares the printed key if needed.
3. Use the **same** person key locally and on the host, then `uni pull` / `uni push`.

- **pull** — published facts only  
- **push** — send proposed / review / feedback / published (not an automatic publish)

## Deploy

See **[docs/deploy.md](docs/deploy.md)** for running a host (Node or Docker, SQLite or PostgreSQL).

## Related

| | |
|--|--|
| [unifact.ai](https://unifact.ai) | Product site |
| [User guide](docs/user-guide.html) | Onboarding for everyone |
| This repo | Registry engine (API, MCP, CLI) |

AI shouldn't remember everything. It should know where to find the truth.

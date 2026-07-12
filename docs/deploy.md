# Deploy UniFact

UniFact is a normal Node.js (or Docker) service plus a database. It is **not tied to any cloud vendor**. You can run it on any host that provides:

- A machine or container for the API (Linux is typical)
- **PostgreSQL** for a shared origin/registry host, **or** SQLite for a single-node / laptop install
- HTTPS in front of the API (reverse proxy, load balancer, or your platform’s TLS)

A VPS, bare metal, laptop, or any major cloud all work the same way at the application layer.

## What you run

| Piece | Role |
|-------|------|
| **UniFact process** | REST + lifecycle + keys/registries (`PORT`, default `4110`) |
| **Database** | SQLite file **or** Postgres via `DATABASE_URL` |
| **Clients** | `uni` CLI, MCP, or apps calling the HTTP API with a person API key |

Health check: `GET /healthz`  
Example response includes `backend` (`sqlite` \| `postgres`).

## Local / single node (SQLite)

```bash
npm install
npm run build
npm run seed   # optional
npm start      # or: npm run dev
```

Default DB file: `./store.db` (override with `DATABASE_PATH`).

Useful commands after `npm link`:

```text
uni init Unifact --person admin
uni join Unifact --person alice
uni approve Unifact --person alice --by admin   # share printed key with alice
uni suspend Unifact --person alice --by admin   # pause access
uni approve Unifact --person alice --by admin   # restore (same secret)
uni pull
uni push
uni push policy/feeling_*                      # selective
```

Members must use the **approved** key (same secret as origin). A local-only key without write namespaces gets **403** on push.
Prefer **approve / suspend** for membership; `uni key on|off` is low-level.
## Shared origin (PostgreSQL)

For a team registry host, use Postgres:

```text
PORT=4110
NODE_ENV=production
DATABASE_URL=postgresql://USER:ENCODED_PASSWORD@HOST:5432/unifact?sslmode=require
```

Notes:

- URL-encode special characters in the password.
- On first boot UniFact creates schema (and can create database `unifact` when the role allows).
- Do **not** rely on `UNIFACT_MASTER_KEY` for product auth. Person keys live in the `api_keys` table (`uni init` / `uni join` / `uni approve`).
- Keep the database reachable from the UniFact process; do not expose Postgres to the public internet.

Auth for apps (for example the unifact.ai UI) uses a **person or scoped API key**, not a cloud vendor secret:

```text
UNIFACT_URL=https://your-registry-host.example
UNIFACT_API_KEY=<enabled person API key>
```

## Docker

This repo includes a `Dockerfile` (port `4110`).

Typical pattern:

```text
build image → run container → set DATABASE_URL (recommended for shared hosts)
           → put TLS/reverse proxy in front → point DNS at the proxy
```

If you use SQLite inside a container, mount a persistent volume for the DB file or you will lose data when the container is replaced. Prefer Postgres for any shared/staging/production registry.

## Networking (vendor-neutral)

```text
Browsers / uni / MCP / apps
  → HTTPS
  → UniFact API (:4110 behind proxy)
  → PostgreSQL (private network)
```

Expose only the API (and MCP if you choose). Keep the database private.

## Will this work on any cloud or on-prem?

**Yes.** UniFact does not call a specific vendor’s control-plane APIs to store facts. It needs:

1. Node 20+ (or the Docker image)
2. Disk (SQLite) or a Postgres server
3. Outbound HTTPS if you use `uni meta` (GitHub/GitLab public APIs) or sync to a remote host

What *does* change by provider is ops glue only: how you provision the VM/container, attach disks, issue TLS certificates, and firewall Postgres. The same binary and env vars work everywhere.

Optional: you may add a concrete recipe for one provider later; it is not required for UniFact to function.

## Checklist

- [ ] Process listens on `4110` (or your `PORT`)
- [ ] `/healthz` returns `ok: true`
- [ ] Shared host uses `DATABASE_URL` (Postgres)
- [ ] TLS terminates in front of the API
- [ ] At least one registry exists (`uni init …`)
- [ ] Person keys are issued via join/approve (not env master keys)
- [ ] Clients set upstream URL + use an enabled API key for `uni pull` / `uni push`

Security / tenancy / audit export: **[enterprise-readiness.md](enterprise-readiness.md)**.

# Deploy UniFact on AWS Fargate

UniFact can run as a small containerized service behind an internal or public Application Load Balancer.

## Runtime Shape

- Container: this repository's `Dockerfile`
- Port: `4110`
- Health check: `GET /healthz`
- Persistent database path: `DATABASE_PATH=/data/store.db` (SQLite local/default)
- Or set `DATABASE_URL` for PostgreSQL (staging/origin on Lightsail RDS); when set, SQLite is not used
- Recommended persistence for SQLite: mount an encrypted EFS volume at `/data`

SQLite on Fargate needs persistent storage. Without EFS, the database lives on task storage and can be lost when the task is replaced. Prefer `DATABASE_URL` (Postgres) for shared staging/origin registries.

## Required Environment Variables

```text
PORT=4110
NODE_ENV=production
DATABASE_PATH=/data/store.db
# Or for Postgres origin/staging:
# DATABASE_URL=postgresql://dbmasteruser:ENCODED_PASSWORD@HOST:5432/unifact?sslmode=require
UNIFACT_MASTER_KEY=<strong secret>
```

For `dahg-ai` to call UniFact:

```text
UNIFACT_URL=https://<unifact-service-host>
UNIFACT_API_KEY=<same value as UNIFACT_MASTER_KEY or scoped API key>
```

When those are set, dahg-ai writes interview facts to this registry on deploy (namespaces `smb.<agentId>.<category>`), reads them at chat time, and exposes a facts UI at `/facts/<agentId>`.
## Recommended Network Setup

For the first integration:

```text
dahg-ai app
  -> HTTPS
  -> UniFact ALB
  -> ECS/Fargate UniFact task
  -> EFS mounted at /data
```

For production enterprise installs, prefer a private ALB or service-to-service networking and expose UniFact only to approved applications and MCP clients.

## Notes

- DynamoDB remains the `dahg-ai` app store for deployed agent records.
- UniFact owns verified facts, interview-derived facts, decisions, rules, and audit history.
- EFS gives persistence, but not unlimited write concurrency. Start with one UniFact writer task; add a storage adapter later for Postgres/Turso/libSQL if scale demands it.

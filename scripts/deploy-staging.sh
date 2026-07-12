#!/usr/bin/env bash
# Deploy UniFact to staging.unifact.ai from a machine that has the Lightsail PEM.
#
# Facts (company.infrastructure):
#   staging-ssh-key-path, staging-ssh-user, staging-app-dir, unifact-deploy-script
#
# Usage (Git Bash / WSL / macOS / Linux):
#   export UNIFACT_SSH_KEY="${UNIFACT_SSH_KEY:-/c/Users/admin/git/LightsailDefaultKey-us-east-1.pem}"
#   ./scripts/deploy-staging.sh
#
# Host has no git — we rsync built artifacts, then pm2 restart.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY="${UNIFACT_SSH_KEY:-$HOME/git/LightsailDefaultKey-us-east-1.pem}"
# Windows path fallback when run from Git Bash:
if [[ ! -f "$KEY" && -f "/c/Users/admin/git/LightsailDefaultKey-us-east-1.pem" ]]; then
  KEY="/c/Users/admin/git/LightsailDefaultKey-us-east-1.pem"
fi
HOST="${UNIFACT_SSH_HOST:-staging.unifact.ai}"
USER="${UNIFACT_SSH_USER:-admin}"
APP_DIR="${UNIFACT_APP_DIR:-/var/www/unifact}"
SSH=(ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes)
RSYNC_RSH="ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes"

if [[ ! -f "$KEY" ]]; then
  echo "SSH key not found: $KEY"
  echo "Set UNIFACT_SSH_KEY to company.infrastructure/staging-ssh-key-path"
  exit 1
fi

echo "==> Building locally in $ROOT"
cd "$ROOT"
npm install
npm run build

echo "==> Syncing to ${USER}@${HOST}:${APP_DIR}"
# Preserve remote .env and data/; do not overwrite secrets.
rsync -az --delete \
  --exclude node_modules \
  --exclude .env \
  --exclude data \
  --exclude store.db \
  --exclude store.db-shm \
  --exclude store.db-wal \
  --exclude .git \
  -e "$RSYNC_RSH" \
  "$ROOT/" "${USER}@${HOST}:${APP_DIR}/"

echo "==> npm install + pm2 restart on host"
"${SSH[@]}" "${USER}@${HOST}" "cd ${APP_DIR} && npm install --omit=dev && sudo pm2 restart unifact && sudo pm2 save && curl -fsS http://127.0.0.1:4110/healthz && echo"

echo "==> Deploy finished. Verify: curl -s http://${HOST}/healthz"
echo "    Expect POST /v1/registries for public org create."

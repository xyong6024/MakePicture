#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRANCH="${1:-main}"
cd "$APP_DIR"

echo "[1/6] Fetching latest code from origin/$BRANCH..."
git fetch origin "$BRANCH"

echo "[2/6] Switching to branch $BRANCH..."
git checkout "$BRANCH"

echo "[3/6] Resetting working tree to origin/$BRANCH..."
git reset --hard "origin/$BRANCH"

echo "[4/6] Ensuring runtime directories..."
mkdir -p outputs/generated work/uploads

echo "[5/6] Refreshing runtime..."
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe makepicture >/dev/null 2>&1; then
    pm2 restart makepicture --update-env
  else
    pm2 start ecosystem.config.cjs --only makepicture --update-env
  fi

  pm2 save >/dev/null 2>&1 || true
else
  echo "PM2 not found. Starting fallback process..."
  nohup node src/server.mjs > work/server.log 2>&1 &
fi

echo "[6/6] Done."
if command -v pm2 >/dev/null 2>&1; then
  pm2 status makepicture
fi

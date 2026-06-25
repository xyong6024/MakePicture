#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "[1/5] Checking environment..."
command -v node >/dev/null 2>&1 || { echo "Node.js is required."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required."; exit 1; }

if [ ! -f ".env" ]; then
  echo "[2/5] Creating .env from template..."
  cp .env.example .env
  echo "Please edit .env before continuing."
  exit 0
fi

echo "[2/5] Ensuring runtime directories..."
mkdir -p outputs/generated work/uploads

echo "[3/5] Installing PM2 if missing..."
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi

echo "[4/5] Starting service..."
if pm2 describe makepicture >/dev/null 2>&1; then
  pm2 delete makepicture >/dev/null 2>&1 || true
fi
pm2 start ecosystem.config.cjs --only makepicture --update-env
pm2 save

echo "[5/5] Done."
pm2 status makepicture

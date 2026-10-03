#!/usr/bin/env bash
# Atualiza e (re)sobe a aplicação. Rodar em /opt/postagem no servidor.
# Uso: bash deploy/deploy.sh [branch]
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="${1:-main}"

if [ ! -f .env.production ]; then
  echo "Falta .env.production (copie de .env.production.example)." >&2
  exit 1
fi

echo "==> Atualizando código ($BRANCH)"
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only

echo "==> Construindo imagens e aplicando migrations"
docker compose --env-file .env.production -f docker-compose.prod.yml build --pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --remove-orphans

echo "==> Limpando imagens antigas"
docker image prune -f >/dev/null

echo "==> Status"
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -fsS -o /dev/null -w "web: HTTP %{http_code}\n" http://127.0.0.1:3022/login || echo "web ainda não respondeu; veja: docker compose -f docker-compose.prod.yml logs -f web"

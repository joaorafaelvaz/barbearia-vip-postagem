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

ln -sf .env.production .env

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
echo "==> Aguardando o web responder em 127.0.0.1:3022"
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3022/login || true)
  if [ "$code" = "200" ]; then echo "web: HTTP 200 (ok)"; exit 0; fi
  sleep 2
done
echo "web não respondeu 200 em 60s (último código: $code). Veja: docker compose -f docker-compose.prod.yml logs --tail 50 web"
exit 1

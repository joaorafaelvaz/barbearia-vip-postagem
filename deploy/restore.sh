#!/usr/bin/env bash
# Restaura um backup gerado por deploy/backup.sh neste servidor (depois do setup-server.sh).
# Uso: bash deploy/restore.sh <postagem-backup-....tar.gz>   (rodar em /opt/postagem)
# Mantém AUTH_URL/APP_DOMAIN/WEB_PORT deste servidor e traz o resto do .env.production do backup.
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?Informe o arquivo de backup}"
[ -f "$FILE" ] || { echo "Arquivo não encontrado: $FILE" >&2; exit 1; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar -C "$WORK" -xzf "$FILE"
[ -f "$WORK/db.dump" ] && [ -f "$WORK/uploads.tar.gz" ] && [ -f "$WORK/env.production" ] || { echo "Backup incompleto." >&2; exit 1; }

compose() { docker compose --env-file .env.production -f docker-compose.prod.yml "$@"; }

echo "==> .env.production: segredos e integrações do backup; domínio e porta deste servidor"
if [ -f .env.production ]; then
  cp .env.production ".env.production.bak-$(date +%Y%m%d-%H%M%S)"
  KEEP="$(grep -E '^(AUTH_URL|APP_DOMAIN|WEB_PORT)=' .env.production || true)"
else
  KEEP=""
fi
cp "$WORK/env.production" .env.production
printf '%s\n' "$KEEP" | while IFS= read -r line; do
  [ -z "$line" ] && continue
  key="${line%%=*}"
  if grep -q "^$key=" .env.production; then sed -i "s|^$key=.*|$line|" .env.production; else printf '%s\n' "$line" >> .env.production; fi
done
ln -sf .env.production .env

echo "==> Parando web e worker"
compose up -d postgres redis
compose stop web worker 2>/dev/null || true

echo "==> Banco de dados: recriando e restaurando"
compose exec -T postgres psql -U fsp -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS fsp WITH (FORCE);" -c "CREATE DATABASE fsp OWNER fsp;"
compose exec -T postgres pg_restore -U fsp -d fsp --no-owner --no-privileges < "$WORK/db.dump"

echo "==> Uploads"
mkdir -p data
tar -C data -xzf "$WORK/uploads.tar.gz"
chown -R 1000:1000 data/uploads

echo "==> Fila: limpando jobs antigos (o worker reenfileira os agendamentos pelo banco)"
compose exec -T redis redis-cli FLUSHALL >/dev/null

echo "==> Subindo a aplicação (migrations pendentes são aplicadas)"
bash deploy/deploy.sh

echo
echo "Restauração concluída. Backup criado em: $(cat "$WORK/created-at.txt" 2>/dev/null || echo '?') (commit $(cut -c1-7 "$WORK/git-commit.txt" 2>/dev/null || echo '?'))."
echo "Confira no painel se as postagens agendadas aparecem; o worker reenfileira todas em até 5 minutos."

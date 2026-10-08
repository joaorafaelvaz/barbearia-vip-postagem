#!/usr/bin/env bash
# Backup completo para migrar ou restaurar: banco (pg_dump), uploads e .env.production.
# Uso: bash deploy/backup.sh [pasta-de-saida]   (rodar em /opt/postagem)
# Gera <pasta>/postagem-backup-AAAAMMDD-HHMMSS.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."
OUT_DIR="${1:-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

[ -f .env.production ] || { echo "Falta .env.production." >&2; exit 1; }
mkdir -p "$OUT_DIR"

compose() { docker compose --env-file .env.production -f docker-compose.prod.yml "$@"; }

echo "==> Banco de dados (pg_dump)"
compose exec -T postgres pg_dump -U fsp -d fsp --no-owner --no-privileges --format=custom > "$WORK/db.dump"

echo "==> Uploads (data/uploads)"
tar -C data -czf "$WORK/uploads.tar.gz" uploads

echo "==> Configuração"
cp .env.production "$WORK/env.production"
git rev-parse HEAD > "$WORK/git-commit.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$WORK/created-at.txt"

FILE="$OUT_DIR/postagem-backup-$STAMP.tar.gz"
tar -C "$WORK" -czf "$FILE" db.dump uploads.tar.gz env.production git-commit.txt created-at.txt
echo
echo "Backup pronto: $FILE ($(du -h "$FILE" | cut -f1))"
echo "Contém: banco, uploads e .env.production (inclui APP_ENCRYPTION_KEY: guarde com cuidado)."

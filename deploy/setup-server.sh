#!/usr/bin/env bash
# Primeira instalação em um servidor Ubuntu/Debian limpo (rodar como root ou com sudo).
# Uso: sudo bash deploy/setup-server.sh <url-do-repositorio-git> [email-para-letsencrypt]
set -euo pipefail

REPO_URL="${1:?Informe a URL do repositório git}"
LE_EMAIL="${2:-admin@barbearia.vip}"
DOMAIN="postagem.barbearia.vip"
APP_DIR="/opt/postagem"

echo "==> Pacotes base"
apt-get update -y
apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> Código em $APP_DIR"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
mkdir -p data/uploads /var/www/certbot
chown -R 1000:1000 data/uploads

if [ ! -f .env.production ]; then
  cp .env.production.example .env.production
  PG_PASS="$(openssl rand -hex 16)"
  sed -i "s|troque-esta-senha|$PG_PASS|g" .env.production
  sed -i "s|^APP_ENCRYPTION_KEY=$|APP_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env.production
  sed -i "s|^AUTH_SECRET=$|AUTH_SECRET=$(openssl rand -hex 32)|" .env.production
  echo "==> .env.production criado com segredos gerados. Preencha META_* e GOOGLE_* depois: $APP_DIR/.env.production"
fi

echo "==> Nginx (HTTP primeiro, para emitir o certificado)"
cat > /etc/nginx/sites-available/$DOMAIN <<NGX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { proxy_pass http://127.0.0.1:3022; proxy_set_header Host \$host; }
}
NGX
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Certificado Let's Encrypt"
certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --non-interactive --agree-tos -m "$LE_EMAIL"

echo "==> Nginx definitivo (HTTPS + proxy)"
cp deploy/nginx/$DOMAIN.conf /etc/nginx/sites-available/$DOMAIN
nginx -t && systemctl reload nginx

echo "==> Subindo a aplicação"
bash deploy/deploy.sh

echo
echo "Pronto: https://$DOMAIN"
echo "Próximos passos: preencher META_APP_ID/META_APP_SECRET e GOOGLE_CLIENT_ID/SECRET em $APP_DIR/.env.production e rodar: bash deploy/deploy.sh"

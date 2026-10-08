#!/usr/bin/env bash
# Primeira instalação em um servidor Ubuntu/Debian limpo (rodar como root ou com sudo).
# Uso: sudo bash deploy/setup-server.sh [url-do-repositorio-git] [email-para-letsencrypt]
# O script pergunta domínio e porta (ou usa DOMAIN=, PORT=, REPO_URL=, LE_EMAIL=, BRANCH= do ambiente).
# Pode ser rodado de novo: atualiza o código, o .env.production, o Nginx e o certificado.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/postagem}"

ask() { # ask <var> <pergunta> <padrão>
  local var="$1" prompt="$2" def="$3" val
  if [ -n "${!var:-}" ]; then return; fi
  if [ -t 0 ]; then
    read -rp "$prompt [$def]: " val
  else
    val=""
  fi
  printf -v "$var" '%s' "${val:-$def}"
}

REPO_URL="${1:-${REPO_URL:-}}"
LE_EMAIL="${2:-${LE_EMAIL:-}}"
ask REPO_URL "URL do repositório git" "https://github.com/joaorafaelvaz/barbearia-vip-postagem.git"
ask DOMAIN   "Domínio público (registro A já apontando para este servidor)" "postagem.barbearia.vip"
ask PORT     "Porta interna do web (só 127.0.0.1; o nginx faz o proxy)" "3022"
ask LE_EMAIL "E-mail para o Let's Encrypt" "admin@${DOMAIN#*.}"

case "$PORT" in ''|*[!0-9]*) echo "Porta inválida: $PORT" >&2; exit 1;; esac
case "$DOMAIN" in *[!A-Za-z0-9.-]*|'') echo "Domínio inválido: $DOMAIN" >&2; exit 1;; esac

echo
echo "Instalando com: domínio=$DOMAIN porta=$PORT pasta=$APP_DIR email=$LE_EMAIL"
echo

echo "==> Pacotes base"
apt-get update -y
apt-get install -y ca-certificates curl git nginx certbot python3-certbot-nginx openssl

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
echo "==> Atualizando código (${BRANCH:-main})"
git fetch --all --prune
git checkout "${BRANCH:-main}"
git pull --ff-only
mkdir -p data/uploads /var/www/certbot
ln -sf .env.production .env   # o Compose lê .env sozinho: comandos avulsos dispensam --env-file
chown -R 1000:1000 data/uploads

if [ ! -f .env.production ]; then
  cp .env.production.example .env.production
  PG_PASS="$(openssl rand -hex 16)"
  sed -i "s|troque-esta-senha|$PG_PASS|g" .env.production
  sed -i "s|^APP_ENCRYPTION_KEY=$|APP_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env.production
  sed -i "s|^AUTH_SECRET=$|AUTH_SECRET=$(openssl rand -hex 32)|" .env.production
  echo "==> .env.production criado com segredos gerados. Preencha META_* e GOOGLE_* depois: $APP_DIR/.env.production"
fi

# Domínio e porta: gravados no .env.production (compose e deploy.sh leem de lá)
set_env() { # set_env <chave> <valor>
  if grep -q "^$1=" .env.production; then sed -i "s|^$1=.*|$1=$2|" .env.production; else printf '%s=%s\n' "$1" "$2" >> .env.production; fi
}
set_env AUTH_URL "https://$DOMAIN"
set_env APP_DOMAIN "$DOMAIN"
set_env WEB_PORT "$PORT"

render_nginx() { # render_nginx <template> <destino>
  sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__PORT__|$PORT|g" "$1" > "$2"
}

echo "==> Nginx (HTTP primeiro, para emitir o certificado)"
cat > /etc/nginx/sites-available/$DOMAIN <<NGX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { proxy_pass http://127.0.0.1:$PORT; proxy_set_header Host \$host; }
}
NGX
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Certificado Let's Encrypt"
certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --non-interactive --agree-tos -m "$LE_EMAIL"

echo "==> Nginx definitivo (HTTPS + proxy em 127.0.0.1:$PORT)"
[ -f deploy/nginx/site.conf.template ] || { echo "Falta deploy/nginx/site.conf.template: o código em $APP_DIR está desatualizado (git pull)." >&2; exit 1; }
render_nginx deploy/nginx/site.conf.template /etc/nginx/sites-available/$DOMAIN
nginx -t && systemctl reload nginx

echo "==> Subindo a aplicação"
bash deploy/deploy.sh

echo
echo "Pronto: https://$DOMAIN  (web interno em 127.0.0.1:$PORT)"
echo "Próximos passos: preencher META_APP_ID/META_APP_SECRET e GOOGLE_CLIENT_ID/SECRET em $APP_DIR/.env.production e rodar: bash deploy/deploy.sh"
echo "Callbacks OAuth a cadastrar: https://$DOMAIN/api/oauth/meta/callback e https://$DOMAIN/api/oauth/google/callback"

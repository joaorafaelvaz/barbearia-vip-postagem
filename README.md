# Publicador Social Multi-Unidade

Software para redes de franquia publicarem **a mesma postagem em todas as unidades**, no
Instagram, Facebook e Google Meu Negócio (Google Business Profile), em um **horário
escolhido**, com uma única ação.

- Cadastre unidades e conecte as contas de cada uma (OAuth Meta e Google).
- Crie um post (texto + imagens), selecione N unidades × M plataformas, escolha data/hora.
- O sistema converte o horário para o fuso de cada unidade, agenda e publica em background.
- Painel com calendário, status por conta (agendado / publicando / publicado / falhou),
  re-tentar e cancelar.

## Stack

TypeScript ponta a ponta. Monorepo pnpm:

| Pasta | O que é |
|---|---|
| `apps/web` | Next.js 15 (UI + API + callbacks OAuth) |
| `apps/worker` | Worker BullMQ que publica no horário |
| `packages/db` | Prisma + PostgreSQL |
| `packages/core` | Regras puras: criptografia de tokens, fuso horário, limites por plataforma |
| `packages/connectors` | Adaptadores Facebook Page, Instagram, Google Business Profile e OAuth |
| `packages/queue` | Enfileirar / cancelar / re-enfileirar jobs |

Plano e arquitetura: `docs/plan/multi-unit-social-publisher.md`, `docs/architecture.md`,
`docs/adr/`.

## Rodando localmente

Pré-requisitos: Node 22+, pnpm 11, Docker.

```bash
pnpm install
cp .env.example .env            # preencha APP_ENCRYPTION_KEY e AUTH_SECRET (abaixo)
docker compose up -d            # Postgres + Redis
pnpm db:migrate                 # cria as tabelas
pnpm --filter @fsp/db seed      # (opcional) rede de exemplo com contas falsas
pnpm dev                        # web em http://localhost:3000 + worker
```

Gerar segredos:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # APP_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # AUTH_SECRET
```

Login do seed: `dono@rede.local` / `senha12345`. As contas do seed são falsas: a
publicação real exige conectar contas de verdade via OAuth.

## Testes

```bash
pnpm test                          # unitários (core, connectors, queue, worker, web)
pnpm --filter @fsp/web test:e2e    # Playwright (precisa de Postgres + Redis rodando)
```

## Conectando as plataformas

### Meta (Facebook Pages + Instagram)

1. Crie um app em <https://developers.facebook.com/apps> do tipo **Business**.
2. Adicione o produto **Facebook Login for Business** e configure a URL de redirecionamento
   `https://SEU-DOMINIO/api/oauth/meta/callback` (em dev: `http://localhost:3000/api/oauth/meta/callback`).
3. Copie `App ID` e `App Secret` para `META_APP_ID` e `META_APP_SECRET`.
4. Em **App Review**, solicite as permissões `pages_show_list`, `pages_read_engagement`,
   `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`.
   Enquanto o app está em modo de desenvolvimento, só usuários com papel no app
   (admin/desenvolvedor/testador) conseguem conectar contas.
5. Cada unidade precisa de uma **Facebook Page** com um **Instagram Business/Creator**
   vinculado. O app publica via Content Publishing API (limite de 25 posts/24h por conta).

### Google Business Profile

1. Crie um projeto em <https://console.cloud.google.com>, habilite as APIs
   **My Business Account Management**, **My Business Business Information** e
   **Google My Business API (v4, para posts)**.
2. **Solicite acesso à API** pelo formulário oficial da Business Profile API. Sem a aprovação,
   as chamadas retornam erro de cota/permissão.
3. Crie credenciais OAuth 2.0 (aplicativo web) com redirect
   `https://SEU-DOMINIO/api/oauth/google/callback` e preencha `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.
4. O usuário que conecta deve ser proprietário/gerente dos perfis das unidades.

### Mídia

Em desenvolvimento as imagens ficam em `apps/web/public/uploads`. Em produção configure um
bucket S3 compatível (`S3_*` no `.env`), pois as plataformas baixam a imagem de uma URL pública.

## Deploy

`apps/web/Dockerfile` e `apps/worker/Dockerfile` geram imagens independentes. Ambas precisam
das mesmas variáveis de ambiente (`DATABASE_URL`, `REDIS_URL`, `APP_ENCRYPTION_KEY`, `AUTH_*`,
`META_*`, `GOOGLE_*`, `S3_*`). Rode `pnpm db:deploy` antes de subir a versão nova.

## Segurança

- Tokens de acesso são cifrados com AES-256-GCM antes de ir ao banco e nunca aparecem em logs.
- Toda consulta da camada web filtra por `organizationId` da sessão (multi-tenant).
- O `state` do OAuth é um JWT assinado com validade de 10 minutos (anti-CSRF).

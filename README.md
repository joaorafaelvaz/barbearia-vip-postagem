# Publicador Social Multi-Unidade

Software para redes de franquia publicarem **a mesma postagem em todas as unidades**, no
Instagram, Facebook e Google Meu Negócio (Google Business Profile), em um **horário
escolhido**, com uma única ação.

- Cadastre unidades e conecte as contas de cada uma (OAuth Meta e Google).
- Crie um post (texto + imagens, ou um vídeo), selecione N unidades × M plataformas, escolha data/hora.
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
pnpm dev                        # web em http://localhost:3022 + worker
```

Gerar segredos:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # APP_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # AUTH_SECRET
```

Logins do seed: `dono@rede.local` / `senha12345` (administrador) e `gestor@rede.local` / `senha12345` (gestor com acesso só à Unidade Manaus). As contas do seed são falsas: a
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
   `https://SEU-DOMINIO/api/oauth/meta/callback` (em dev: `http://localhost:3022/api/oauth/meta/callback`).
3. Copie `App ID` e `App Secret` para `META_APP_ID` e `META_APP_SECRET`.
4. Em **App Review**, solicite as permissões abaixo (todas são pedidas no login, veja
   `META_SCOPES` em `packages/connectors/src/oauth/meta.ts`). Não inclua `publish_video`:
   ela não existe no Facebook Login for Business e causa o erro "Invalid Scopes".

   | Permissão | Para que serve |
   |---|---|
   | `pages_show_list` | Listar as Páginas do usuário na tela de conexão |
   | `pages_read_engagement` | Ler dados básicos da Página e localizar a conta Instagram vinculada |
   | `pages_read_user_content` | Importar as publicações antigas do feed da Página (90 dias) |
   | `pages_manage_posts` | Publicar texto, fotos, vídeos, Stories e Reels na Página |
   | `read_insights` | Coletar métricas da Página (alcance, impressões, cliques) |
   | `instagram_basic` | Identificar a conta Instagram Business e listar as mídias publicadas |
   | `instagram_content_publish` | Publicar Feed, carrossel, Stories e Reels no Instagram |
   | `instagram_manage_insights` | Coletar métricas do Instagram (alcance, visualizações, salvamentos, compartilhamentos) |
   | `business_management` | Acessar Páginas e contas Instagram ligadas ao Gerenciador de Negócios |

   Enquanto o app está em modo de desenvolvimento, só usuários com papel no app
   (admin/desenvolvedor/testador) conseguem conectar contas. Contas conectadas antes de
   uma permissão ser adicionada precisam ser reconectadas em **Unidades**.
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

### Formatos: Feed, Story e Reel

Na composição escolha o formato. **Feed** é o padrão (imagens, carrossel ou vídeo; única opção
para o Google Meu Negócio). **Story** aceita uma imagem ou um vídeo e não envia legenda (as APIs
não suportam); no Facebook usa `photo_stories`/`video_stories`, no Instagram `media_type=STORIES`.
**Reel** exige um vídeo; no Facebook usa `video_reels` (upload em fases por URL), no Instagram
`media_type=REELS`. Story e Reel só em Facebook e Instagram.

### Corte automático para Stories

Stories aceitam vídeo de até 60s (Instagram e Facebook). Ao agendar um Story com vídeo mais
longo, o worker corta o arquivo com **ffmpeg** em partes iguais de até 59s (máximo de 10
partes) e publica uma atrás da outra, na ordem. O corte roda assim que a postagem é
agendada (job `prepare-media`) e as partes ficam gravadas como `MediaAsset` filhos do
vídeo original, então 30 unidades reaproveitam o mesmo corte. Se uma parte falhar depois
de outras já publicadas, o alvo fica FAILED sem retentativa automática, para não duplicar.
Requisitos: `ffmpeg` na imagem do worker (já incluído) e o volume de uploads montado no
worker (`UPLOADS_DIR`), ou S3 configurado.

### Pré-visualização e capa do Reel

A tela Nova postagem mostra uma aproximação de como a postagem aparece em cada canal
selecionado (feed do Instagram e do Facebook, cartão do Google, Story e Reel em 9:16).
Para Reels é possível escolher a capa: um quadro do vídeo (slider, capturado no navegador
como JPEG) ou uma imagem JPG enviada. O Instagram recebe `cover_url` (e `thumb_offset`
como reserva); no Facebook a imagem vai para `POST /{video_id}/thumbnails` depois da
publicação, e uma falha nesse passo não derruba o Reel.

### Mídia

Imagens: JPG, PNG, GIF (o Instagram só aceita JPG). Vídeo: MP4 ou MOV, um por postagem, sem
misturar com imagens. No Instagram o vídeo é publicado como **Reels** (3s a 15min); no Facebook,
como vídeo da Page (coberto por `pages_manage_posts`). O **Google Business Profile não aceita vídeo em
postagens via API**, então a composição bloqueia vídeo quando há conta do Google selecionada.
Duração e dimensões do vídeo são lidas no navegador no momento do upload; o servidor não
decodifica vídeo. Limite de upload: 10MB por imagem, 300MB por vídeo.

Em desenvolvimento as mídias ficam em `apps/web/public/uploads`. Em produção configure um
bucket S3 compatível (`S3_*` no `.env`), pois as plataformas baixam a imagem de uma URL pública.

## Deploy

Produção roda em Docker Compose (`docker-compose.prod.yml`: web em 127.0.0.1 na porta
`WEB_PORT`, worker, Postgres e Redis) com o Nginx do host como proxy reverso e HTTPS do
Let's Encrypt. Os arquivos estão em `deploy/`. Domínio e porta são escolhidos na instalação
e ficam gravados em `.env.production` (`AUTH_URL`, `APP_DOMAIN`, `WEB_PORT`).

### Primeira instalação (servidor Ubuntu/Debian limpo)

1. Aponte o registro A do domínio escolhido para o IP do servidor.
2. No servidor, como root:

```bash
curl -fsSL https://raw.githubusercontent.com/joaorafaelvaz/barbearia-vip-postagem/main/deploy/setup-server.sh -o setup-server.sh
sudo bash setup-server.sh
```

   O script pergunta a URL do repositório, o **domínio**, a **porta interna do web** e o
   e-mail do Let's Encrypt (Enter aceita o padrão: `postagem.barbearia.vip`, `3022`). Para
   rodar sem perguntas, passe as respostas no ambiente:
   `DOMAIN=app.exemplo.com PORT=3100 LE_EMAIL=eu@exemplo.com sudo -E bash setup-server.sh`.
   Depois instala Docker, Nginx e certbot, clona o repositório em `/opt/postagem`, cria
   `.env.production` com segredos gerados e com domínio/porta escolhidos, emite o certificado,
   gera o Nginx a partir de `deploy/nginx/site.conf.template` e sobe a aplicação
   (`deploy/deploy.sh`).
3. Preencha `META_APP_ID`, `META_APP_SECRET`, `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`
   em `/opt/postagem/.env.production` e rode `bash deploy/deploy.sh` de novo.
4. Nos apps da Meta e do Google, cadastre os redirects
   `https://SEU-DOMINIO/api/oauth/meta/callback` e
   `https://SEU-DOMINIO/api/oauth/google/callback` (o script imprime as URLs no final).

Para trocar domínio ou porta depois, rode o `setup-server.sh` de novo com os novos valores:
ele atualiza `.env.production`, o Nginx e o certificado, e o `deploy.sh` passa a usar a nova porta.

### Atualizações

```bash
cd /opt/postagem && bash deploy/deploy.sh
```

Faz `git pull`, reconstrói as imagens, aplica as migrations (serviço `migrate`) e reinicia
web e worker. Logs: `docker compose -f docker-compose.prod.yml logs -f web worker` (o `.env` é um link para
`.env.production`, então os comandos do Compose não precisam de `--env-file`).

### Mídia em produção

Sem S3 configurado, as mídias ficam em `/opt/postagem/data/uploads` (volume do compose) e o
Nginx as serve em `/uploads/`. Isso é obrigatório porque Meta e Google baixam a mídia por URL
pública. Para usar S3/R2, preencha as variáveis `S3_*`. O limite de upload no Nginx é 320MB.

## Analytics

O menu **Analytics** mostra, por período (7, 30 ou 90 dias), unidade e plataforma: publicadas,
falhas e taxa de sucesso; gráfico de publicações por dia; engajamento (curtidas, comentários,
compartilhamentos, salvamentos, alcance, impressões, cliques); ranking por unidade e por
plataforma; publicações com mais engajamento; e motivos das falhas.

O engajamento é coletado pelo worker a cada 6 horas para publicações dos últimos 30 dias
(tabela `TargetMetrics`), e sob demanda pelo botão "Atualizar métricas" (no máximo uma coleta
por minuto por organização). Curtidas e comentários vêm com as permissões básicas; alcance,
impressões e salvamentos exigem `read_insights` (Facebook) e `instagram_manage_insights`
(Instagram), já incluídos no OAuth: contas conectadas antes dessa versão precisam ser
reconectadas para liberar essas métricas. No Google Business Profile, as métricas de post
dependem da API `localPosts:reportInsights`; quando ela não responde, a publicação fica marcada
como parcial sem interromper a coleta.

### Importação do histórico

Publicações feitas fora do sistema nos últimos 90 dias são importadas de cada conta conectada
(Facebook: posts da Página; Instagram: mídias da conta; Google: posts da ficha) para a tabela
`ExternalPost`, marcadas como "importada" no Analytics. A importação roda ao conectar uma conta,
uma vez por dia no worker e pelo botão "Importar publicações". O engajamento das importadas é
atualizado pela mesma coleta de métricas.

## Usuários e permissões

- **Administrador**: vê todas as unidades, cadastra unidades, conecta contas, cria usuários e
  delega unidades a cada gestor em **Usuários**. Pode desativar usuários e promover gestores.
- **Gestor**: só vê e publica nas unidades delegadas. Não cadastra unidades nem acessa a
  gestão de usuários. A API devolve 403 fora desse escopo.
- O cadastro público em `/registro` só funciona até existir a primeira organização; depois
  disso responde 403 e a tela de login deixa de oferecer "Criar conta". `ALLOW_SIGNUP=true`
  reabre (usado em desenvolvimento e nos testes).
- Cada usuário troca a própria senha em **Minha conta**. Usuários são criados pelo
  administrador com uma senha inicial (não há envio de e-mail).

## Interface

Tema claro e escuro: segue a preferência do sistema por padrão; o botão na barra lateral
fixa a escolha no navegador (`localStorage`), aplicada antes da primeira pintura para não
piscar. Tokens de cor ficam em `apps/web/src/app/globals.css` (claro) e
`globals.dark.css` (escuro).

## Segurança

- Tokens de acesso são cifrados com AES-256-GCM antes de ir ao banco e nunca aparecem em logs.
- Toda consulta da camada web filtra por `organizationId` da sessão (multi-tenant).
- O `state` do OAuth é um JWT assinado com validade de 10 minutos (anti-CSRF).

# Plano — Publicador Social Multi-Unidade (Franquias)

## Contexto

Rede de franquias (barbearias) com várias unidades. Cada unidade possui contas próprias
no Instagram, Facebook e Google Business Profile (Google Meu Negócio). Hoje as postagens
são feitas manualmente, unidade por unidade.

## Objetivo

Um software web onde o franqueador cria **uma** postagem, seleciona **múltiplas unidades**
(e, dentro delas, quais plataformas), escolhe um **horário específico** e o sistema
publica automaticamente em todas as contas selecionadas.

## Requisitos funcionais

- RF1. Cadastro de unidades e conexão das contas de cada unidade (Instagram Business,
  Facebook Page, Google Business Profile location).
- RF2. Criar um post (texto + mídia) e selecioná-lo para N unidades × M plataformas.
- RF3. Agendar para data/hora específica, respeitando o fuso horário de cada unidade.
- RF4. Publicação automática em background com retentativas e registro de status por conta.
- RF5. Painel com calendário, status por unidade (pendente, publicado, falhou), e botão
  de re-tentar.
- RF6. Multi-tenant: um franqueador (organização) vê apenas suas unidades.

## Restrições e fatos de plataforma (verificar na documentação oficial antes de implementar)

- **Instagram**: só contas Business/Creator vinculadas a uma Facebook Page. Publicação via
  Content Publishing API (criar container → publicar). Limite de 25 posts por conta a cada
  24h. Mídia precisa de URL pública.
- **Facebook Page**: publicação via Graph API com Page Access Token de longa duração.
- **Google Business Profile**: `locations.localPosts.create`; exige aprovação de acesso à
  API (solicitação de cota). Tipos STANDARD, EVENT, OFFER. Mídia via `sourceUrl` pública.
- **Meta App Review** necessário para `pages_manage_posts`, `instagram_content_publish`,
  `pages_read_engagement`, `business_management`.
- Tokens de acesso são segredos: armazenar criptografados (AES-GCM), nunca em logs.

## Stack escolhida

- TypeScript end-to-end: Next.js (App Router) para UI + API, Node worker separado.
- PostgreSQL via Prisma. Fila: BullMQ sobre Redis.
- Armazenamento de mídia: S3-compatível (Cloudflare R2 ou AWS S3) com URLs públicas.
- Testes: Vitest (unitário/integração), Playwright (E2E).

---

## Step 1 — Arquitetura e desenho do sistema

Definir a arquitetura: monorepo com `apps/web` (Next.js), `apps/worker` (BullMQ),
`packages/db` (Prisma), `packages/connectors` (adaptadores por plataforma). Decidir
fronteiras, contratos entre web e worker, estratégia de multi-tenant e fuso horário.
Avaliar alternativas (agendar via `scheduled_publish_time` nativo do Facebook vs. fila
própria) e registrar a decisão em ADR.

Critérios de aceite: documento de arquitetura com diagrama de componentes; ADR da decisão
de agendamento; estrutura de pastas do monorepo criada e buildando vazio.

Out of scope: implementação de qualquer conector.

## Step 2 — Schema do banco de dados

Criar o schema Prisma e a migration inicial: `Organization`, `User`, `Unit` (com
`timezone`), `ConnectedAccount` (platform, externalId, tokens criptografados, expiresAt),
`Post` (conteúdo, mídia), `PostTarget` (post × conta, com `scheduledAt` em UTC, `status`,
`externalPostId`, `lastError`), `MediaAsset`. Índices para consultas do worker
(`status, scheduledAt`) e do calendário (`organizationId, scheduledAt`).

Critérios de aceite: `prisma migrate dev` limpo em banco vazio; testes de repositório
para criar post com múltiplos targets; constraint única em `(postId, connectedAccountId)`.

## Step 3 — Autenticação do app e OAuth com Meta

Implementar login do franqueador (Auth.js) e o fluxo OAuth com a Meta: trocar code por
token de usuário, listar Pages, obter Page Access Token de longa duração e o Instagram
Business Account vinculado a cada Page. Salvar em `ConnectedAccount` com tokens
criptografados via AES-GCM (chave em `APP_ENCRYPTION_KEY`). Vincular cada conta a uma
`Unit`.

Critérios de aceite: fluxo completo mockado em testes; tokens nunca aparecem em
plaintext no banco nem em logs; renovação de token antes de expirar.

Out of scope: publicação de conteúdo.

## Step 4 — OAuth com Google Business Profile

Implementar OAuth 2.0 com Google (escopo `business.manage`), listar `accounts` e
`locations`, salvar refresh token criptografado e vincular cada location a uma `Unit`.
Documentar o processo de solicitação de acesso à API do GBP.

Critérios de aceite: refresh automático de access token; location vinculada a unidade;
erro claro quando a API ainda não está aprovada para o projeto.

Out of scope: publicação de conteúdo.

## Step 5 — Upload e validação de mídia (imagens e vídeo)

Implementar upload para S3/R2 com URL pública, geração de thumbnails e validação por
plataforma: dimensões/proporção e tamanho para Instagram (imagem JPEG, proporção 4:5 a
1.91:1), Facebook e GBP (mínimo 250×250, JPG/PNG). Rejeitar antes de agendar o que não
atende a alguma plataforma selecionada.

Vídeo (adicionado em 2026-10-03): MP4/MOV, um por post, sem misturar com imagens. Instagram
publica como Reels (`media_type=REELS`, `video_url`, `share_to_feed`); Facebook via
`/{page-id}/videos` (`file_url`, exige `publish_video`); Google Business Profile não aceita
vídeo em posts via API, então a composição bloqueia essa combinação. Metadados do vídeo
(duração, dimensões) são lidos no navegador.

Critérios de aceite: testes de validação para cada regra; upload retorna URL pública
acessível; mídia inválida bloqueia o agendamento com mensagem por plataforma.

## Step 6 — Conectores de publicação

Implementar `packages/connectors` com interface comum `Publisher.publish(target)` e três
adaptadores: Facebook Page (`/{page-id}/feed` e `/photos`), Instagram (criar container
em `/{ig-user-id}/media`, aguardar `status_code=FINISHED`, publicar em `/media_publish`)
e GBP (`locations.localPosts.create`). Mapear erros da API para erros tipados
(rate limit, token inválido, mídia rejeitada) e respeitar o limite de 25 posts/24h
do Instagram.

Critérios de aceite: testes com HTTP mockado para sucesso e cada classe de erro;
`externalPostId` retornado em sucesso; nenhum token logado.

## Step 7 — Motor de agendamento e fan-out

Implementar o worker BullMQ: ao criar um `Post` com N targets, enfileirar um job por
`PostTarget` com `delay` até `scheduledAt` (convertido do horário local da unidade para
UTC). Idempotência por `postTargetId` (job id determinístico), retentativas com backoff
exponencial para erros transitórios, sem retentativa para erros permanentes. Atualizar
`status`, `externalPostId` e `lastError`.

Critérios de aceite: teste de que dois enfileiramentos do mesmo target não duplicam
publicação; conversão de fuso horário testada com DST; job falho fica `FAILED` com erro
legível.

Out of scope: UI do painel.

## Step 8 — API e tela de composição em massa

Criar a rota de criação de post e a tela de composição: editor de texto, anexar mídia,
selecionar unidades (com "selecionar todas"), selecionar plataformas por unidade,
escolher data/hora com indicação do fuso de cada unidade, pré-visualização por
plataforma, confirmar. A API valida limites de caracteres por plataforma e cria
`Post` + `PostTarget`s em transação.

Critérios de aceite: criar um post para 3 unidades × 3 plataformas gera 9 targets em uma
transação; validação de limite de caracteres por plataforma; E2E do fluxo de composição.

## Step 9 — Painel de calendário e status

Implementar o painel: calendário mensal/semanal com posts agendados, lista por unidade
com status (pendente, publicando, publicado, falhou), detalhe do erro, botão "re-tentar"
que reenfileira o target, e botão "cancelar" para pendentes.

Critérios de aceite: re-tentar reenfileira apenas o target falho; cancelar remove o job
da fila; filtros por unidade e plataforma funcionam.

## Step 10 — Testes end-to-end dos fluxos críticos

Cobrir com Playwright, contra APIs externas mockadas: conectar contas Meta e Google,
criar post em massa agendado, worker publica no horário, painel reflete status e
re-tentativa de falha.

Critérios de aceite: suíte E2E verde em CI; cenário de falha e re-tentativa coberto;
nenhum teste depende de credenciais reais.

## Step 11 — Auditoria de segurança

Auditar o projeto: armazenamento de tokens, isolamento multi-tenant em todas as queries,
validação de URLs de mídia (SSRF), proteção CSRF nos callbacks OAuth (state), segredos em
variáveis de ambiente, headers de segurança.

Critérios de aceite: nenhuma query sem filtro por `organizationId`; relatório de
auditoria sem achados críticos ou altos.

## Step 12 — Documentação e deploy

Escrever README com setup local, variáveis de ambiente, passo a passo para criar o app
na Meta e solicitar App Review, e para solicitar acesso à API do GBP. Dockerfile para
web e worker, `docker-compose` com Postgres e Redis, e guia de deploy.

Critérios de aceite: um desenvolvedor novo sobe o ambiente seguindo apenas o README;
`docker compose up` deixa web + worker + banco + redis funcionando.

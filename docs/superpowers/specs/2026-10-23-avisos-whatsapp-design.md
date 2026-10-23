# Avisos WhatsApp (nativo no Publicador da Rede) — Design

Data: 2026-10-23 · Status: aprovado pelo usuário ("aprovado, pode seguir com /avisos") · Origem do comportamento: `daily/docs/superpowers/specs/2026-10-23-admin-dashboard-design.md` §5–§6 (já validado em produção em Python)

## 1. Objetivo

Trazer para dentro do Publicador da Rede (`apps/web` + `apps/worker`) a funcionalidade de **mensagens agendadas de WhatsApp** que hoje vive no repositório `daily` (Flask + SQLite + APScheduler), reimplementada nativamente em TypeScript, com o mesmo comportamento:

- A franqueadora escreve um aviso (ou gera com IA a partir de um assunto), escolhe unidades (ou todas, ou o grupo da franqueadora), data/hora do primeiro envio, repetição (único/diária/semanal/mensal) e data final opcional.
- O worker envia no horário via WAHA, grava o resultado por destino, tolera atrasos até 2 h, retenta sem duplicar, pausa após 3 falhas consecutivas.
- Tela única `/avisos` com formulário, "Enviar teste para mim", lista de próximos envios (pausar/retomar/editar/cancelar) e histórico.

Visível e acessível **somente** para `role = OWNER` (menu, páginas e API; `MANAGER` recebe 403). O repositório Python **não é alterado**: os dois sistemas convivem até a franqueadora desligar o job do `daily`.

Fora de escopo: personalização por unidade, mídia nos avisos, relatórios por data (ficam no `daily`).

## 2. Arquitetura

```
navegador ──HTTPS──▶ nginx ──▶ apps/web (Next.js 15, /avisos + /api/whatsapp-notices/*)
                                   │ Prisma                     │ BullMQ (fila "publish")
                                   ▼                            ▼
                              PostgreSQL ◀──────────────── apps/worker
                         WhatsappNotice / WhatsappDelivery   job "whatsapp-notice" (1 por ocorrência)
                         Unit.whatsappChatId                 + reconcileNotices (a cada 5 min, junto do
                         Organization.whatsappChatId           reconcile de publicações)
                         User.whatsappChatId                         │
                                                                     ▼ POST /api/sendText (X-Api-Key)
                                                                   WAHA ──▶ WhatsApp
apps/web ── @anthropic-ai/sdk (claude-opus-5-5) ── "Gerar com IA"
apps/web ── WAHA direto ── "Enviar teste para mim" (imediato, só para o próprio usuário)
```

Diferenças deliberadas em relação ao `daily` (job de 1 em 1 minuto varrendo o SQLite):

- **Um job BullMQ por ocorrência**, com `delay` até o horário e **jobId determinístico** `whatsapp-notice-<noticeId>-<occurrenceAt ms>-<tentativa>` — mesmo padrão de `post-target-<id>` (ADR 0001). A "tentativa" é o valor de `consecutiveFailures` no momento do enfileiramento (0, 1 ou 2): BullMQ ignora `add` com jobId repetido, então a retentativa do minuto seguinte precisa de um id novo; como 3 falhas pausam o aviso, o conjunto de ids é finito.
- **Reconciliação a cada 5 min** (dentro do job `reconcile-targets` já existente, em `apps/worker/src/main.ts`): (0) `enviando` há mais de 10 min volta a `ativo` (worker caiu no meio do envio); (1) todo aviso `ativo` com `nextRunAt` e sem job na fila é reenfileirado (Redis recriado, migração de servidor). Equivale aos passos 0–1 do job do `daily`.
- **Multi-tenant**: `organizationId` em `WhatsappNotice` e `WhatsappDelivery`; toda consulta da camada web filtra pela sessão, como `Post`.
- **Destinos resolvidos no envio** a partir do banco (`Unit.whatsappChatId`, `Organization.whatsappChatId`), não de `unit_groups.json`.

## 3. Módulos e arquivos

| Pacote | Arquivo | Responsabilidade |
|---|---|---|
| `packages/db` | `prisma/schema.prisma` (modificar) | `whatsappChatId` em `Unit`, `Organization`, `User`; modelos `WhatsappNotice`, `WhatsappDelivery`; enums |
| `packages/db` | `prisma/migrations/<ts>_whatsapp_notices/migration.sql` (gerada) | migration |
| `packages/db` | `scripts/import-whatsapp-groups.ts` (criar) | importa `unit_groups.json` do `daily` para `Unit.whatsappChatId` |
| `packages/core` | `src/whatsapp-notices.ts` (criar) | tipos, constantes, `nextOccurrence()` (pura), `resolveNoticeTargets()`, `noticeJobId()`, transições de estado, `normalizeUnitName()` |
| `packages/core` | `src/__tests__/whatsapp-notices.test.ts` (criar) | casos do `daily` (`test_agendamentos.py`) portados 1:1 |
| `packages/queue` | `src/index.ts` (modificar) | `enqueueNotice`, `dequeueNotice`, `hasNoticeJob`; `WhatsappNoticeJobData` em `AppJobData` |
| `packages/connectors` | `src/waha.ts` (criar), `src/__tests__/waha.test.ts` | cliente WAHA (`sendText` nunca lança; 2 tentativas) |
| `apps/worker` | `src/whatsapp-notices.ts` (criar) | `processNotice()` (passos 2–5), `reconcileNotices()` (passos 0–1), interfaces `NoticeRepository`/`WhatsappSender` |
| `apps/worker` | `src/repository.ts` (modificar) | `prismaNoticeRepository(prisma)` |
| `apps/worker` | `src/main.ts` (modificar) | despacho do job `whatsapp-notice`; reconciliação; `WahaClient.fromEnv()` |
| `apps/worker` | `src/__tests__/whatsapp-notices.test.ts` (criar) | casos de `test_agendamentos_job.py` com fila/repo/sender falsos |
| `apps/web` | `src/lib/services/whatsapp-notices.ts` (criar) + `.test.ts` | validação (zod), CRUD, transições, edição, teste imediato |
| `apps/web` | `src/lib/services/whatsapp-ai.ts` (criar) + `.test.ts` | geração com IA (SDK Anthropic) |
| `apps/web` | `src/lib/prompts/aviso-whatsapp.ts` (criar) | system prompt (texto idêntico a `daily/admin/prompts/mensagem_sistema.txt`) |
| `apps/web` | `src/lib/authz.test.ts` (criar) | `requireAdmin` → 403 para MANAGER |
| `apps/web` | `src/app/api/whatsapp-notices/route.ts`, `[id]/route.ts`, `[id]/state/route.ts`, `test/route.ts`, `generate/route.ts` (criar) | API (todas com `requireAdmin`) |
| `apps/web` | `src/app/api/units/[id]/route.ts` (modificar: `PATCH`), `src/app/api/organization/route.ts` (criar: `PATCH`), `src/app/api/account/whatsapp/route.ts` (criar: `PATCH`) | edição dos `chatId` |
| `apps/web` | `src/app/(app)/avisos/page.tsx` (criar) | página (server component, `requireSession` + `isAdmin` → `redirect("/")`) |
| `apps/web` | `src/components/NoticeComposer.tsx`, `NoticeList.tsx`, `NoticeHistory.tsx`, `ChatIdField.tsx` (criar) | UI (client components) |
| `apps/web` | `src/components/AppSidebar.tsx`, `Icons.tsx` (modificar) | link "Avisos WhatsApp" (só `isAdmin`), `IconWhatsapp` |
| `apps/web` | `src/app/(app)/unidades/page.tsx`, `conta/page.tsx` (modificar) | campos de `chatId` |
| raiz | `.env.example`, `.env.production.example`, `README.md` (modificar) | variáveis e documentação |

## 4. Modelo de dados (Prisma)

```prisma
model Organization {
  // ...existente
  /// Grupo/número WhatsApp da franqueadora (destino "Franqueadora" dos avisos). Formato WAHA: 123@g.us ou 55DDDN@c.us
  whatsappChatId  String?
  whatsappNotices WhatsappNotice[]
}

model User {
  // ...existente
  /// Número do próprio usuário para "Enviar teste para mim" (formato WAHA)
  whatsappChatId String?
}

model Unit {
  // ...existente
  /// Grupo WhatsApp do franqueado desta unidade (formato WAHA). Null = unidade não recebe avisos.
  whatsappChatId String?
}

enum WhatsappNoticeState {
  ativo
  pausado
  enviando
  concluido
  cancelado
}

enum WhatsappDeliveryStatus {
  enviado
  falhou
  perdido
  pausado
}

/// Aviso agendado para grupos de WhatsApp das unidades (espelha `agendamentos` do daily).
model WhatsappNotice {
  id             String              @id @default(cuid())
  organizationId String
  text           String
  /// {"unidades":[unitId...],"todas":bool,"franqueadora":bool} — chat_ids resolvidos no envio
  targets        Json
  /// Primeiro envio em UTC (escolhido no fuso America/Sao_Paulo)
  firstSendAt    DateTime
  /// {"tipo":"nenhuma"} | {"tipo":"diaria"} | {"tipo":"semanal","dias":[0..6]} | {"tipo":"mensal","dia":1..31|"ultimo"}
  recurrence     Json
  endAt          DateTime?
  /// Próxima ocorrência (UTC); null quando concluído/cancelado
  nextRunAt      DateTime?
  state          WhatsappNoticeState @default(ativo)
  consecutiveFailures Int            @default(0)
  /// Reserva do ciclo em curso (passo 1); liberada por reconcileNotices após 10 min
  sendingStartedAt DateTime?
  createdById    String?
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  organization Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  deliveries   WhatsappDelivery[]

  @@index([organizationId, state, nextRunAt])
  @@index([state, nextRunAt])
}

/// Resultado de um envio por destino (espelha `envios`). Linha "de sistema": chatId "-", targetName "sistema".
model WhatsappDelivery {
  id             String                 @id @default(cuid())
  organizationId String
  noticeId       String
  /// nextRunAt que originou o disparo
  occurrenceAt   DateTime
  sentAt         DateTime               @default(now())
  chatId         String
  targetName     String
  status         WhatsappDeliveryStatus
  error          String?

  notice WhatsappNotice @relation(fields: [noticeId], references: [id], onDelete: Cascade)

  @@unique([noticeId, occurrenceAt, chatId])
  @@index([organizationId, sentAt])
}
```

Convenções herdadas do `daily`: `UNIQUE(noticeId, occurrenceAt, chatId)` (uma linha por destino por ocorrência; a retentativa faz *upsert*), linha de sistema `chatId="-"` / `targetName="sistema"` / `status=pausado` com o motivo em `error` ("pausado automaticamente apos 3 falhas consecutivas" ou "sem destinos válidos") — uma por ocorrência por causa do UNIQUE.

Os JSONs `targets` e `recurrence` mantêm **exatamente as chaves do `daily`** (`unidades/todas/franqueadora`, `tipo/dias/dia`), com `unidades` guardando cuids de `Unit` em vez de ids numéricos do ERP.

## 5. Regras de recorrência e do job

### 5.1 Próxima ocorrência (`packages/core`, função pura)

`nextOccurrence(after: Date | null, first: Date, rec: NoticeRecurrence, end: Date | null): Date | null`, relógio sempre em **`America/Sao_Paulo`** (`NOTICE_TIMEZONE`, igual ao `daily`; não usa `Unit.timezone`). Implementada sobre `localToUtc`/`utcToLocal` de `packages/core/src/timezone.ts`:

- Mantém o **horário** (HH:mm) de `first`.
- `nenhuma`: `first` se `after` é null ou `first > after`; senão null.
- Demais: candidato = dia de `first` (se `after` null) ou dia de `after` no horário de `first` (+1 dia se esse instante ≤ `after`); se candidato < `first`, volta ao dia de `first`. Então avança até casar: `diaria` → o próprio; `semanal` → próximo dia da semana ∈ `dias` (0 = segunda); `mensal` → dia alvo do mês (`"ultimo"` ou `min(dia, dias do mês)`; 31 → 30/28), mês a mês.
- Resultado > `end` → null.

Casos de teste (portados de `tests/test_agendamentos.py`): única (primeira vez / já disparou), diária mantém horário, semanal [seg, sex] a partir de quarta, mensal 31→30 e `"ultimo"` em fevereiro, `fim` encerra.

### 5.2 Ciclo de envio (`apps/worker`, `processNotice`)

Job `whatsapp-notice` com `data = { noticeId, occurrenceAt }` (ISO). Passos (numeração do `daily`):

0. **Recuperação** (em `reconcileNotices`, a cada 5 min e na subida do worker): `enviando` com `sendingStartedAt` < agora − 10 min → `ativo`, e reenfileira.
1. **Reserva atômica**: `updateMany({ where: { id, state: "ativo", nextRunAt: occurrenceAt }, data: { state: "enviando", sendingStartedAt: now } })`; `count !== 1` → job encerra como `skipped` (aviso editado/pausado/cancelado ou ocorrência já avançada). Impede duplicidade entre jobs e entre worker e reconciliação.
2. `agora − occurrenceAt > 2 h` → grava `perdido` para cada destino, **não envia**, avança para a próxima ocorrência como ciclo bom.
3. Sem destinos válidos (unidades sem `whatsappChatId`, franqueadora sem grupo) → `pausado` já nesta falha, com linha de sistema "sem destinos válidos". Senão, para cada `chatId` **sem `enviado` nesta `occurrenceAt`**: `sender.sendText(chatId, text)`, **1,5 s entre envios** (`sleep` injetável; só *entre* envios), grava `enviado`/`falhou` (`sendText` nunca lança, devolve `false`).
4. ≥ 1 `enviado` (incluindo os de ciclos anteriores da mesma ocorrência) = ciclo bom: `consecutiveFailures = 0`, `nextRunAt = nextOccurrence(occurrenceAt, …)`; null → `concluido`, senão `ativo` + **enfileira o job da próxima ocorrência** (tentativa 0).
5. Falha do ciclo (exceção, ou todos `falhou`): `consecutiveFailures += 1`, **sem avançar** a data; `< 3` → `ativo` e reenfileira a **mesma ocorrência** para agora + 60 s com id de tentativa `n`; `= 3` → `pausado` + linha de sistema. Retomar na tela zera o contador.

`finishCycle` só grava se a linha **ainda está `enviando`** (`updateMany where state = enviando`): um cancelar/pausar clicado durante o envio prevalece (a UI não oferece ações enquanto `enviando`, mas a reconciliação ou um segundo operador podem interferir).

### 5.3 Transições de estado e edição (`apps/web`)

Lista branca, idêntica ao `daily` (`TRANSICOES`): `ativo ← pausado`, `pausado ← ativo`, `cancelado ← ativo | pausado`. Qualquer outra → 409. `pausado` e `cancelado` removem o job pendente da fila (`dequeueNotice`; um job ativo não é removido — o passo 1 já falhou a reserva ou o `finishCycle` será ignorado pela regra acima). Retomar: `consecutiveFailures = 0` e reenfileira `nextRunAt` (ou "agora" se já venceu — a regra das 2 h decide).

Edição (`PATCH /api/whatsapp-notices/[id]`): só `ativo` ou `pausado` (`enviando` → **409** "aguarde o envio em curso"; `concluido`/`cancelado` → 404). **Preserva `pausado`.** Nova `nextRunAt`: se a ocorrência atual já venceu sem ser enviada (`nextRunAt ≤ agora`) **e** `firstSendAt` + `recurrence` não mudaram → mantém (não pula o envio atrasado; se `end` novo a exclui → `concluido`); senão `nextOccurrence(first < agora ? agora : null, first, rec, end)`. Zera `consecutiveFailures`. Remove o job antigo e enfileira o novo (se `ativo`).

### 5.4 Validação (serviço, zod + regras)

`text` 1–4000 caracteres (trim); ≥ 1 destino válido (`unidades` ⊆ unidades da organização, ou `todas`, ou `franqueadora`); `firstSendLocal` (`YYYY-MM-DDTHH:mm`, Sao Paulo) ≥ agora + 1 min — na edição esse limite vale só se `firstSendAt` mudou; `semanal` exige ≥ 1 dia (0–6); `mensal` exige `dia` 1–31 ou `"ultimo"`; `endDate` (`YYYY-MM-DD`, vira 23:59 de Sao Paulo) ≥ primeiro envio. Erros → `HttpError(400)` com mensagem humana (padrão de `services/posts.ts`).

## 6. Interface (`/avisos`)

Página server component (`requireSession`; `!isAdmin → redirect("/")`, como `usuarios/page.tsx`) que carrega unidades (`id, name, whatsappChatId`), `organization.whatsappChatId`, `user.whatsappChatId`, avisos `ativo|pausado|enviando` ordenados por `nextRunAt` e os 200 últimos `WhatsappDelivery`, e renderiza:

- `page-head` "Avisos WhatsApp" + `lead`.
- Alertas `alert info` quando faltam `WAHA_URL` (envio desabilitado), `ANTHROPIC_API_KEY` (botão IA desabilitado), grupo da franqueadora ou unidades sem grupo (link para Unidades e contas), `User.whatsappChatId` (link para Minha conta).
- `NoticeComposer` (client) em `grid composer`: coluna esquerda `card stack lg` com seções numeradas (`section-title` + `num`, como `PostComposer`): **1 Texto** (`field` + `textarea`, contador, prévia WhatsApp com `*negrito*`/`_itálico_` escapando HTML antes), **Gerar com IA** (assunto, `select` tom Amigável/Formal/Urgente, botão com `spinner`; nunca agenda automaticamente), **2 Destinos** (`chip` "Todas as unidades", `chip` "Franqueadora", `chip` por unidade — unidades sem `whatsappChatId` aparecem desabilitadas com `title` explicando), **3 Quando** (`input datetime-local` primeiro envio, `select` repetição, `chip`s Seg–Dom para semanal, `input` dia do mês ou `ultimo`, `input date` "Até"). Coluna direita `card`: resumo ("Próximo envio", "Destinos: N unidades + franqueadora", "Repetição") e `action-bar` com `btn primary` **Agendar** / **Salvar alterações** (modo edição) e `btn` **Enviar teste para mim** (desabilitado sem `User.whatsappChatId`). Erros em `alert error`, sucesso em `alert ok`; `router.refresh()` após salvar (padrão `UnitForm`).
- `NoticeList` (`card` + `table-wrap`): Próximo, Texto (`shorten`), Destinos, Repetição, Estado (`badge` com classe por estado: `ativo`→`SCHEDULED`, `enviando`→`PUBLISHING`, `pausado`→`FAILED`, mais rótulo pt-BR), Ações (`btn small`: Pausar/Retomar, Editar, Cancelar com `confirm`; nada enquanto `enviando` — mostra "enviando…"). `empty` quando vazio.
- `NoticeHistory` (`card` + `table-wrap`): Quando (`formatInTz(sentAt, "America/Sao_Paulo")`), Destino, Status (`badge`: `enviado`→`PUBLISHED`, `falhou`→`FAILED`, `perdido`→`CANCELLED`, `pausado`→`PUBLISHING`), Texto (60 chars), Erro.
- Menu: `AppSidebar` ganha `{ label: "Avisos WhatsApp", href: "/avisos", icon: <IconWhatsapp /> }` dentro do mesmo spread condicional `isAdmin` que já gera "Usuários".

Onde editar os `chatId` (menor invasão possível):
- **Unidade** — em `unidades/page.tsx`, dentro de cada `section.card` da unidade, abaixo do cabeçalho, um `ChatIdField` (client; `input` + `btn small` Salvar → `PATCH /api/units/[id]` `{ whatsappChatId }`), só para `admin`.
- **Franqueadora** — no topo de `unidades/page.tsx`, logo após o `UnitForm` (só `admin`), um `card` "Grupo WhatsApp da franqueadora" com o mesmo `ChatIdField` → `PATCH /api/organization`.
- **Usuário** — em `conta/page.tsx`, nova `section.card` "Meu WhatsApp (para testes de aviso)" com `ChatIdField` → `PATCH /api/account/whatsapp` (qualquer papel pode preencher; só OWNER usa).

Formato aceito nos três: `^\d{5,20}(-\d+)?@(g|c)\.us$` ou vazio (apaga). Observação herdada do `daily`: números no JID antigo de 12 dígitos (sem o nono dígito) é o que o WAHA reconhece para alguns contatos.

## 7. Geração com IA (`apps/web/src/lib/services/whatsapp-ai.ts`)

- SDK oficial `@anthropic-ai/sdk`. Chamada: `client.beta.messages.create({ model: "claude-opus-5-5", max_tokens: 1024, output_config: { effort: "low" }, system: AVISO_WHATSAPP_SYSTEM_PROMPT, messages: [{ role: "user", content: \`Assunto: ${assunto}\nTom: ${tom}\` }], betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { timeout: 30_000, maxRetries: 1 })` — mesmos parâmetros do `daily/admin/ia.py`. O cliente é injetável (interface mínima `NoticeAiClient`) para os testes não tocarem a rede; a rota adapta o SDK real.
- `stop_reason === "refusal"` → `HttpError(400, "A IA não conseguiu gerar uma mensagem para esse assunto. Reformule o pedido.")`. Texto = primeiro bloco `text`, trimado; vazio → erro "A IA retornou vazio. Tente de novo.".
- Erros (cadeia específica → genérica, como no Python): `Anthropic.AuthenticationError` → 400 "Chave da Anthropic inválida. Confira ANTHROPIC_API_KEY."; `Anthropic.RateLimitError` → 429 "Limite de uso da IA atingido. Tente de novo em instantes."; `Anthropic.APIConnectionTimeoutError`/`APIConnectionError` → 504 "Sem resposta da IA (tempo esgotado). Tente de novo."; `Anthropic.APIError` com `status >= 500` → 503 "Serviço de IA indisponível no momento.", demais → 400 com a mensagem. Sem `ANTHROPIC_API_KEY` → 503 "IA não configurada (ANTHROPIC_API_KEY)." e botão desabilitado na tela.
- System prompt: texto **idêntico** a `daily/admin/prompts/mensagem_sistema.txt`, como constante TS (`src/lib/prompts/aviso-whatsapp.ts`) — um arquivo `.txt` lido em runtime não entra no *standalone* do Next por padrão.
- Custo estimado < US$ 0,01 por geração.

## 8. Autorização e multi-tenancy

- Menu: só `isAdmin(session)`. Página: `requireSession()` + `isAdmin` senão `redirect("/")`. API `/api/whatsapp-notices/*` e `/api/organization`: `requireSession()` + `requireAdmin(s)` (→ `HttpError(403)` via `route()`). `PATCH /api/units/[id]`: `requireAdmin`. `PATCH /api/account/whatsapp`: qualquer usuário autenticado, só o próprio registro.
- Todo acesso a `WhatsappNotice`/`WhatsappDelivery` filtra `organizationId` da sessão; `unidades` dos destinos são validadas contra a organização (400 se alguma não pertencer). O worker não tem sessão: carrega pelo `noticeId` e resolve destinos pela `organizationId` do próprio aviso.

## 9. Configuração e variáveis de ambiente

Novas (lidas em `apps/web` com `optionalEnv()`/`process.env`, e em `apps/worker` com `process.env`; documentadas em `.env.example` e `.env.production.example`):

```
# Avisos WhatsApp (WAHA — WhatsApp HTTP API). Vazio desabilita o envio.
WAHA_URL=http://127.0.0.1:3000
WAHA_API_KEY=
WAHA_SESSION=default
# Botão "Gerar com IA" na tela de Avisos (console.anthropic.com). Vazio desabilita o botão.
ANTHROPIC_API_KEY=
```

Dependências novas: `@anthropic-ai/sdk` em `apps/web`. Nada novo no worker (`fetch` nativo do Node 22). Deploy: a migration roda no serviço `migrate` do `docker-compose.prod.yml` (`prisma migrate deploy`) como hoje; basta acrescentar as variáveis em `.env.production` e rodar `bash deploy/deploy.sh`. O `daily` continua intocado; quando a franqueadora decidir, desliga lá o job `agendamentos` (fora deste plano).

Importação única dos grupos: `pnpm --filter @fsp/db import:whatsapp-groups -- "D:/Dev/Barbearia VIP/daily/config/unit_groups.json"` (opcional `--org <organizationId>` quando houver mais de uma). Casa `units[*].nome` com `Unit.name` sem acentos/caixa/espaços duplicados; preenche `Unit.whatsappChatId` (sobrescreve só com `--force`); imprime casados, pulados e **não casados** (dos dois lados) para ajuste manual na tela.

## 10. Erros e observabilidade

- Web: `route()` converte `HttpError`/`ZodError` em JSON com status; stack trace só no console do container.
- Worker: `log("notice sent"|"notice retry"|"notice paused"|"notice missed"|"notice skipped", { noticeId, occurrenceAt, ... })` no mesmo formato JSON de `processTarget`; `reconcileNotices` loga `{ staleReleased, requeued }` quando > 0. Falhas por destino ficam em `WhatsappDelivery.error` ("WAHA retornou falha", "atraso > 2h").
- Nunca logar `WAHA_API_KEY`, `ANTHROPIC_API_KEY` nem o texto completo (só no banco).

## 11. Testes

- `packages/core`: `nextOccurrence` (5 casos do `daily` 1:1), `resolveNoticeTargets` (dedup, ordem, franqueadora, unidades sem chat), `noticeJobId`, `canTransition`, `normalizeUnitName`.
- `packages/connectors`: `WahaClient.sendText` — payload/headers exatos, `true` em 2xx, `false` após 2 tentativas (sem lançar), header `X-Api-Key` só com chave.
- `apps/worker`: `processNotice` com fila/repo/sender falsos — envia vencido e avança; > 2 h → `perdido`; sucesso parcial = ciclo ok; 3 falhas pausam sem avançar (ids de tentativa 1, 2 enfileirados); retentativa não reenvia a quem já recebeu; reserva falha → `skipped`; sem destinos → pausado com linha de sistema. `reconcileNotices`: solta presos, reenfileira sem job, nada a fazer.
- `apps/web`: `whatsapp-notices.test.ts` (schema/validações, `planUpdate` da edição — pausado preservado, ocorrência vencida mantida, 409 em `enviando`), `whatsapp-ai.test.ts` (parâmetros exatos da chamada, recusa → erro amigável, sem chave → 503), `authz.test.ts` (`requireAdmin` lança 403 para MANAGER).
- E2E (Playwright, opcional, mesma infra de `permissoes.spec.ts`): gestor não vê o link e recebe 403 em `GET /api/whatsapp-notices`; admin agenda e vê na lista.
- Manual em produção: checklist no plano (Chunk 4).

## 12. Decisões registradas

- Fuso do agendamento: `America/Sao_Paulo` para toda a rede (igual ao `daily`), **não** `Unit.timezone`.
- Um job por ocorrência + reconciliação (padrão do repo), em vez de varredura por minuto; jobId com sufixo de tentativa por causa do `add` idempotente do BullMQ.
- Estados e status mantidos em português (`ativo|pausado|enviando|concluido|cancelado`, `enviado|falhou|perdido|pausado`) e JSONs com as chaves do `daily`, para a migração mental da franqueadora ser nula; o resto do schema em inglês/camelCase como o repo.
- Reconciliação acoplada ao job `reconcile-targets` existente (sem novo scheduler).
- "Enviar teste para mim" usa `User.whatsappChatId` (por usuário) em vez de um `ADMIN_TEST_CHAT_ID` global.
- O grupo da franqueadora mora em `Organization.whatsappChatId` e é editado na página Unidades e contas (sem criar página de configurações).
- Prompt da IA como constante TS, não arquivo lido em runtime.
- Sem alteração no repositório Python; a importação dos grupos é um script único, não uma sincronização.

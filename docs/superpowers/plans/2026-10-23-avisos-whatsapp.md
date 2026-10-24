# Avisos WhatsApp (nativo no Publicador da Rede) — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar em `/avisos` (menu "Avisos WhatsApp", só `OWNER`) o agendamento de avisos de WhatsApp para as unidades — texto livre ou gerado por IA, destinos, data/hora, repetição, data final — com envio pelo worker via WAHA, histórico por destino e as mesmas regras já validadas em produção no repositório `daily` (Python).

**Architecture:** Prisma (`WhatsappNotice`, `WhatsappDelivery`, `whatsappChatId` em `Unit`/`Organization`/`User`) → serviços e rotas em `apps/web` → um job BullMQ por ocorrência na fila `publish` (`whatsapp-notice`, jobId determinístico com sufixo de tentativa) processado em `apps/worker`, mais reconciliação a cada 5 min dentro do job `reconcile-targets` existente. Regras puras (recorrência, destinos, ids, transições) em `packages/core`; cliente WAHA em `packages/connectors`; IA pelo SDK oficial da Anthropic em uma rota do web.

**Tech Stack:** TypeScript, pnpm 11.3.0 (workspace), Next.js 15 (app router), Prisma 6 + PostgreSQL, BullMQ 5 + Redis, zod 3, vitest 3, `@anthropic-ai/sdk`.

**Spec:** `docs/superpowers/specs/2026-10-23-avisos-whatsapp-design.md` — a fonte da verdade; em dúvida, siga a spec. Comportamento de referência: `D:\Dev\Barbearia VIP\daily\admin\agendamentos.py`, `scheduler\agendamentos_job.py`, `admin\ia.py`.

**Convenções deste plano (verificadas no repo):**
- Gerenciador: **pnpm** (`packageManager: pnpm@11.3.0`, `pnpm-lock.yaml`). Testes: `vitest run` por pacote — `pnpm --filter @fsp/core test`, `pnpm --filter @fsp/connectors test`, `pnpm --filter @fsp/worker test`, `pnpm --filter @fsp/web test`; suíte completa `pnpm test`. Tipos: `pnpm typecheck`.
- Pacotes `packages/*` são ESM com `"type": "module"`: imports relativos **com `.js`** (`../index.js`); testes em `src/__tests__/*.test.ts`. Em `apps/web` imports sem extensão, alias `@/`, testes `src/**/*.test.ts` ao lado do código.
- `apps/web` e `apps/worker` consomem os pacotes **compilados** (`dist/`): depois de mexer em `packages/*`, rode `pnpm -r --filter "./packages/*" build` antes de `typecheck`/`dev` dos apps.
- Rotas de API: `export const GET = route(async (req) => { const s = await requireSession(); requireAdmin(s); ... })` com `HttpError` para erros (ver `apps/web/src/app/api/users/route.ts`).
- Prisma: `pnpm --filter @fsp/db migrate:dev --name <snake_case>` (carrega `../../.env` via `dotenv-cli`); depois `pnpm --filter @fsp/db build` (gera o client e compila).
- Todo commit termina com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Trabalhe na branch `feat/avisos-whatsapp`; nunca em `main`.
- Fuso dos avisos: sempre `NOTICE_TIMEZONE` (`America/Sao_Paulo`). Nunca `new Date().getHours()` nem `Unit.timezone`.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `packages/db/prisma/schema.prisma` (modificar) | campos `whatsappChatId`, modelos `WhatsappNotice`/`WhatsappDelivery`, enums |
| `packages/db/prisma/migrations/<ts>_whatsapp_notices/migration.sql` (gerada) | migration |
| `packages/db/scripts/import-whatsapp-groups.ts` (criar), `packages/db/package.json` (script) | importação de `unit_groups.json` |
| `packages/core/src/whatsapp-notices.ts` (criar), `src/index.ts` (export) | tipos, constantes, `nextOccurrence`, `resolveNoticeTargets`, `noticeJobId`, `canTransition`, `normalizeUnitName` |
| `packages/core/src/__tests__/whatsapp-notices.test.ts` (criar) | testes das regras puras |
| `packages/queue/src/index.ts` (modificar) | `enqueueNotice`, `dequeueNotice`, `hasNoticeJob`, `AppJobData` |
| `packages/queue/src/__tests__/queue.test.ts` (modificar) | teste do jobId/delay do aviso |
| `packages/connectors/src/waha.ts` (criar), `src/index.ts` (export), `src/__tests__/waha.test.ts` | cliente WAHA |
| `apps/worker/src/whatsapp-notices.ts` (criar) | `processNotice`, `reconcileNotices`, interfaces |
| `apps/worker/src/__tests__/whatsapp-notices.test.ts` (criar) | semântica do job |
| `apps/worker/src/repository.ts`, `src/main.ts` (modificar) | repositório Prisma, despacho, reconciliação, sender |
| `apps/web/src/lib/authz.test.ts` (criar) | `requireAdmin` → 403 |
| `apps/web/src/lib/services/whatsapp-notices.ts` (criar) + `.test.ts` | validação, CRUD, transições, edição, teste imediato |
| `apps/web/src/lib/services/whatsapp-ai.ts` (criar) + `.test.ts`, `src/lib/prompts/aviso-whatsapp.ts` | IA |
| `apps/web/src/app/api/whatsapp-notices/{route,[id]/route,[id]/state/route,test/route,generate/route}.ts` (criar) | API |
| `apps/web/src/app/api/units/[id]/route.ts` (modificar), `api/organization/route.ts`, `api/account/whatsapp/route.ts` (criar) | `chatId` |
| `apps/web/src/app/(app)/avisos/page.tsx` (criar) | página |
| `apps/web/src/components/{NoticeComposer,NoticeList,NoticeHistory,ChatIdField}.tsx` (criar) | UI |
| `apps/web/src/components/{AppSidebar,Icons}.tsx`, `app/(app)/{unidades,conta}/page.tsx` (modificar) | menu, ícone, campos de chatId |
| `.env.example`, `.env.production.example`, `README.md` (modificar) | variáveis e docs |

---

## Chunk 1: Prisma schema + migration + script de importação + regras puras de autorização

### Task 1: Schema Prisma e migration

**Files:** Modify `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Campos novos nos modelos existentes** — em `Organization`, após `updatedAt`, acrescente o campo e, na lista de relações, `whatsappNotices WhatsappNotice[]`:

```prisma
  /// Grupo/número WhatsApp da franqueadora (destino "Franqueadora" dos avisos). Formato WAHA: 123@g.us ou 55DDDN@c.us
  whatsappChatId String?
```

Em `User`, após `isActive`:

```prisma
  /// Número do próprio usuário para "Enviar teste para mim" (formato WAHA)
  whatsappChatId String?
```

Em `Unit`, após `timezone`:

```prisma
  /// Grupo WhatsApp do franqueado desta unidade (formato WAHA). Null = não recebe avisos.
  whatsappChatId String?
```

- [ ] **Step 2: Modelos e enums novos** — ao final de `schema.prisma`:

```prisma
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

/// Aviso agendado para os grupos de WhatsApp das unidades (espelha `agendamentos` do daily).
model WhatsappNotice {
  id                  String              @id @default(cuid())
  organizationId      String
  text                String
  /// {"unidades":[unitId...],"todas":bool,"franqueadora":bool} — chat_ids resolvidos no envio
  targets             Json
  /// Primeiro envio em UTC (escolhido no fuso America/Sao_Paulo)
  firstSendAt         DateTime
  /// {"tipo":"nenhuma"} | {"tipo":"diaria"} | {"tipo":"semanal","dias":[0..6]} | {"tipo":"mensal","dia":1..31|"ultimo"}
  recurrence          Json
  endAt               DateTime?
  /// Próxima ocorrência (UTC); null quando concluído/cancelado
  nextRunAt           DateTime?
  state               WhatsappNoticeState @default(ativo)
  consecutiveFailures Int                 @default(0)
  /// Reserva do ciclo em curso; liberada pela reconciliação após 10 min
  sendingStartedAt    DateTime?
  createdById         String?
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt

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

- [ ] **Step 3: Migration** — Run: `docker compose up -d` (Postgres local) e `pnpm --filter @fsp/db migrate:dev --name whatsapp_notices`
Expected: nova pasta `packages/db/prisma/migrations/<timestamp>_whatsapp_notices/migration.sql` com `ALTER TABLE "Organization" ADD COLUMN "whatsappChatId" TEXT`, idem `User` e `Unit`, `CREATE TYPE "WhatsappNoticeState"`, `CREATE TYPE "WhatsappDeliveryStatus"`, `CREATE TABLE "WhatsappNotice"`, `CREATE TABLE "WhatsappDelivery"`, índices e o `UNIQUE`.

- [ ] **Step 4: Validar e compilar** — Run: `pnpm --filter @fsp/db test && pnpm --filter @fsp/db build`
Expected: `The schema at prisma/schema.prisma is valid`; `dist/` gerado sem erro.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): modelos WhatsappNotice/WhatsappDelivery e whatsappChatId em Unit, Organization e User

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2: Regras puras em `packages/core` — tipos, constantes, `normalizeUnitName`, `resolveNoticeTargets`, `noticeJobId`, `canTransition`

**Files:** Create `packages/core/src/whatsapp-notices.ts`, `packages/core/src/__tests__/whatsapp-notices.test.ts`; Modify `packages/core/src/index.ts`

- [ ] **Step 1: Teste** — `packages/core/src/__tests__/whatsapp-notices.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canTransition, noticeJobId, normalizeUnitName, resolveNoticeTargets, sameRecurrence } from "../whatsapp-notices.js";

describe("sameRecurrence", () => {
  it("compara tipo, dias (ordenados) e dia, ignorando ordem de chaves e de dias (jsonb reordena)", () => {
    expect(sameRecurrence({ tipo: "semanal", dias: [4, 0] }, JSON.parse('{"dias":[0,4],"tipo":"semanal"}'))).toBe(true);
    expect(sameRecurrence({ tipo: "mensal", dia: "ultimo" }, { tipo: "mensal", dia: "ultimo" })).toBe(true);
    expect(sameRecurrence({ tipo: "mensal", dia: 31 }, { tipo: "mensal", dia: "ultimo" })).toBe(false);
    expect(sameRecurrence({ tipo: "diaria" }, { tipo: "nenhuma" })).toBe(false);
    expect(sameRecurrence({ tipo: "semanal", dias: [0] }, { tipo: "semanal", dias: [0, 1] })).toBe(false);
  });
});

describe("normalizeUnitName", () => {
  it("ignora acentos, caixa e espaços repetidos", () => {
    expect(normalizeUnitName("Florianópolis - SC 401")).toBe("florianopolis - sc 401");
    expect(normalizeUnitName("  São  José - Barreiros ")).toBe("sao jose - barreiros");
    expect(normalizeUnitName("CRICIÚMA - Michel")).toBe(normalizeUnitName("Criciúma - michel"));
  });
});

describe("resolveNoticeTargets", () => {
  const units = [
    { id: "u61", name: "SC 401", whatsappChatId: "a@g.us" },
    { id: "u20", name: "Itajaí", whatsappChatId: "b@g.us" },
    { id: "u99", name: "Sem grupo", whatsappChatId: null },
  ];
  it("unidades escolhidas + franqueadora, na ordem, sem duplicar", () => {
    expect(resolveNoticeTargets({ unidades: ["u61", "u20", "u61"], todas: false, franqueadora: true }, units, "f@g.us")).toEqual([
      { chatId: "a@g.us", name: "SC 401" },
      { chatId: "b@g.us", name: "Itajaí" },
      { chatId: "f@g.us", name: "Franqueadora" },
    ]);
  });
  it("todas ignora unidades sem chat e não repete um chat compartilhado", () => {
    const shared = [...units, { id: "u47", name: "Outra", whatsappChatId: "a@g.us" }];
    expect(resolveNoticeTargets({ unidades: [], todas: true, franqueadora: false }, shared, null)).toEqual([
      { chatId: "a@g.us", name: "SC 401" },
      { chatId: "b@g.us", name: "Itajaí" },
    ]);
  });
  it("franqueadora sem grupo cadastrado não entra", () => {
    expect(resolveNoticeTargets({ unidades: [], todas: false, franqueadora: true }, units, null)).toEqual([]);
  });
});

describe("noticeJobId / canTransition", () => {
  it("jobId determinístico por aviso, ocorrência e tentativa", () => {
    const occ = new Date("2026-10-25T18:00:00Z");
    expect(noticeJobId("n1", occ, 0)).toBe("whatsapp-notice-n1-1792951200000-0");
    expect(noticeJobId("n1", occ, 2)).not.toBe(noticeJobId("n1", occ, 0));
  });
  it("só as transições da lista branca", () => {
    expect(canTransition("ativo", "pausado")).toBe(true);
    expect(canTransition("pausado", "ativo")).toBe(true);
    expect(canTransition("pausado", "cancelado")).toBe(true);
    expect(canTransition("cancelado", "ativo")).toBe(false);
    expect(canTransition("enviando", "pausado")).toBe(false);
    expect(canTransition("concluido", "cancelado")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar — deve falhar** — `pnpm --filter @fsp/core test` → `Failed to resolve import "../whatsapp-notices.js"`.

- [ ] **Step 3: Implementar** — `packages/core/src/whatsapp-notices.ts` (a função `nextOccurrence` entra na Task 3; deixe o arquivo compilando sem ela):

```ts
/**
 * Avisos WhatsApp: regras puras compartilhadas entre web (valida, enfileira) e worker (envia).
 * Comportamento espelhado de daily/admin/agendamentos.py e scheduler/agendamentos_job.py.
 */

/** Fuso do relógio dos avisos (toda a rede), igual ao daily. Não usa Unit.timezone. */
export const NOTICE_TIMEZONE = "America/Sao_Paulo";
export const WHATSAPP_NOTICE_JOB_NAME = "whatsapp-notice";
/** Atraso tolerado: além disso a ocorrência é marcada como "perdido" e não é enviada. */
export const NOTICE_MAX_DELAY_MS = 2 * 60 * 60_000;
/** Pausa entre envios a destinos diferentes (só ENTRE envios). */
export const NOTICE_SEND_INTERVAL_MS = 1500;
/** Falhas consecutivas de ciclo que pausam o aviso. */
export const NOTICE_MAX_FAILURES = 3;
/** Espera antes de retentar a mesma ocorrência depois de uma falha de ciclo. */
export const NOTICE_RETRY_DELAY_MS = 60_000;
/** `enviando` há mais que isso é considerado preso (worker caiu no meio do envio). */
export const NOTICE_STALE_SENDING_MS = 10 * 60_000;
export const NOTICE_TEXT_MAX = 4000;

export type NoticeState = "ativo" | "pausado" | "enviando" | "concluido" | "cancelado";
export type DeliveryStatus = "enviado" | "falhou" | "perdido" | "pausado";

/**
 * Mesmas chaves do daily: ids de Unit (cuid) em vez de ids numéricos do ERP.
 * `type` (não `interface`): só um alias de objeto é atribuível ao `Prisma.InputJsonValue` dos campos Json.
 */
export type NoticeTargets = {
  unidades: string[];
  todas: boolean;
  franqueadora: boolean;
};

export type NoticeRecurrence =
  | { tipo: "nenhuma" }
  | { tipo: "diaria" }
  | { tipo: "semanal"; dias: number[] }
  | { tipo: "mensal"; dia: number | "ultimo" };

/** Payload do job: só ids; o worker recarrega tudo do banco. */
export interface WhatsappNoticeJobData {
  noticeId: string;
  /** ISO do nextRunAt que originou o job */
  occurrenceAt: string;
}

/** Transições permitidas pela tela: destino -> estados de origem aceitos (daily TRANSICOES). */
export const NOTICE_TRANSITIONS: Record<"ativo" | "pausado" | "cancelado", NoticeState[]> = {
  ativo: ["pausado"],
  pausado: ["ativo"],
  cancelado: ["ativo", "pausado"],
};

export function canTransition(from: NoticeState, to: NoticeState): boolean {
  const origins = (NOTICE_TRANSITIONS as Partial<Record<NoticeState, NoticeState[]>>)[to];
  return origins !== undefined && origins.includes(from);
}

/**
 * Igualdade semântica de recorrência: tipo, `dias` ordenados, `dia`. Nunca compare o JSON
 * serializado — o jsonb do Postgres reordena as chaves ao gravar.
 */
export function sameRecurrence(a: NoticeRecurrence, b: NoticeRecurrence): boolean {
  if (a.tipo !== b.tipo) return false;
  if (a.tipo === "semanal" && b.tipo === "semanal") {
    const da = [...new Set(a.dias.map(Number))].sort((x, y) => x - y);
    const db = [...new Set(b.dias.map(Number))].sort((x, y) => x - y);
    return da.length === db.length && da.every((d, i) => d === db[i]);
  }
  if (a.tipo === "mensal" && b.tipo === "mensal") return String(a.dia) === String(b.dia);
  return true;
}

/**
 * Job id determinístico. `attempt` = consecutiveFailures no momento de enfileirar: BullMQ ignora
 * `add` com jobId repetido, então a retentativa da mesma ocorrência precisa de um id novo.
 */
export function noticeJobId(noticeId: string, occurrenceAt: Date, attempt: number): string {
  return `whatsapp-notice-${noticeId}-${occurrenceAt.getTime()}-${attempt}`;
}

export interface NoticeUnitChat {
  id: string;
  name: string;
  whatsappChatId: string | null;
}

export interface ResolvedTarget {
  chatId: string;
  name: string;
}

/** [{chatId, name}] no momento do envio, sem duplicar chats (mesma regra do daily). */
export function resolveNoticeTargets(targets: NoticeTargets, units: readonly NoticeUnitChat[], franchisorChatId: string | null): ResolvedTarget[] {
  const out: ResolvedTarget[] = [];
  const seen = new Set<string>();
  const byId = new Map(units.map((u) => [u.id, u]));
  const chosen = targets.todas ? units : targets.unidades.map((id) => byId.get(id)).filter((u): u is NoticeUnitChat => u !== undefined);
  for (const u of chosen) {
    const chat = u.whatsappChatId?.trim();
    if (!chat || seen.has(chat)) continue;
    seen.add(chat);
    out.push({ chatId: chat, name: u.name });
  }
  const f = franchisorChatId?.trim();
  if (targets.franqueadora && f && !seen.has(f)) out.push({ chatId: f, name: "Franqueadora" });
  return out;
}

/** Chave de comparação de nomes de unidade: sem acentos, minúsculas, espaços normalizados. */
export function normalizeUnitName(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
```

Em `packages/core/src/index.ts` acrescente `export * from "./whatsapp-notices.js";`.

Em `packages/core/package.json`, bloco `exports`, acrescente um subpath (componentes client do Next **não podem** importar a raiz `@fsp/core`, que puxa `node:crypto` via `crypto.ts`; `./timezone` já existe pelo mesmo motivo):

```diff
     "./timezone": {
       "types": "./dist/timezone.d.ts",
       "import": "./dist/timezone.js"
+    },
+    "./whatsapp-notices": {
+      "types": "./dist/whatsapp-notices.d.ts",
+      "import": "./dist/whatsapp-notices.js"
     }
   },
```

(`whatsapp-notices.ts` importa só `./timezone.js`, então o subpath é seguro no browser.)

- [ ] **Step 4: Rodar — deve passar** — `pnpm --filter @fsp/core test` → todos os testes do pacote verdes (os 4 `describe` novos).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/whatsapp-notices.ts packages/core/src/__tests__/whatsapp-notices.test.ts packages/core/src/index.ts packages/core/package.json
git commit -m "feat(core): tipos, constantes, destinos, transições e sameRecurrence dos Avisos WhatsApp

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 3: `nextOccurrence` (recorrência, pura) — casos do daily 1:1

**Files:** Modify `packages/core/src/whatsapp-notices.ts`, `packages/core/src/__tests__/whatsapp-notices.test.ts`

- [ ] **Step 1: Teste** — acrescente ao arquivo de teste (importe também `nextOccurrence` e `localToUtc` de `../timezone.js`):

```ts
import { localToUtc } from "../timezone.js";
import { nextOccurrence } from "../whatsapp-notices.js";

/** Horário de parede em São Paulo -> Date UTC (mesmo `dt()` dos testes do daily). */
const sp = (local: string) => localToUtc(local, "America/Sao_Paulo");

describe("nextOccurrence (portado de daily tests/test_agendamentos.py)", () => {
  it("única", () => {
    expect(nextOccurrence(null, sp("2026-10-25T15:00"), { tipo: "nenhuma" }, null)).toEqual(sp("2026-10-25T15:00"));
    expect(nextOccurrence(sp("2026-10-25T15:00"), sp("2026-10-25T15:00"), { tipo: "nenhuma" }, null)).toBeNull();
  });
  it("diária mantém horário", () => {
    expect(nextOccurrence(sp("2026-10-25T15:00"), sp("2026-10-25T15:00"), { tipo: "diaria" }, null)).toEqual(sp("2026-10-26T15:00"));
    expect(nextOccurrence(null, sp("2026-10-25T15:00"), { tipo: "diaria" }, null)).toEqual(sp("2026-10-25T15:00"));
  });
  it("semanal vários dias (0=segunda)", () => {
    const rec = { tipo: "semanal" as const, dias: [0, 4] }; // seg e sex
    expect(nextOccurrence(null, sp("2026-10-21T09:00"), rec, null)).toEqual(sp("2026-10-23T09:00")); // 21/10 é quarta -> sexta 23
    expect(nextOccurrence(sp("2026-10-23T09:00"), sp("2026-10-21T09:00"), rec, null)).toEqual(sp("2026-10-26T09:00")); // -> segunda 26
  });
  it("mensal dia 31 e 'ultimo'", () => {
    expect(nextOccurrence(sp("2026-10-31T08:00"), sp("2026-10-31T08:00"), { tipo: "mensal", dia: 31 }, null)).toEqual(sp("2026-11-30T08:00"));
    expect(nextOccurrence(null, sp("2026-02-10T08:00"), { tipo: "mensal", dia: "ultimo" }, null)).toEqual(sp("2026-02-28T08:00"));
  });
  it("fim encerra", () => {
    expect(nextOccurrence(sp("2026-10-25T15:00"), sp("2026-10-25T15:00"), { tipo: "diaria" }, sp("2026-10-25T23:59"))).toBeNull();
  });
  it("after anterior ao primeiro envio volta ao primeiro", () => {
    expect(nextOccurrence(sp("2026-10-01T10:00"), sp("2026-10-25T15:00"), { tipo: "diaria" }, null)).toEqual(sp("2026-10-25T15:00"));
  });
  it("diária com after no meio do dia, antes do horário, dispara no mesmo dia", () => {
    expect(nextOccurrence(sp("2026-10-26T09:00"), sp("2026-10-25T15:00"), { tipo: "diaria" }, null)).toEqual(sp("2026-10-26T15:00"));
  });
});
```

- [ ] **Step 2: Rodar — deve falhar** (`nextOccurrence` não exportada).

- [ ] **Step 3: Implementar** — acrescente a `packages/core/src/whatsapp-notices.ts` (import no topo: `import { localToUtc, utcToLocal } from "./timezone.js";`):

```ts
interface CivilDate { y: number; m: number; d: number }

function civilOf(date: Date): { day: CivilDate; time: string } {
  const local = utcToLocal(date, NOTICE_TIMEZONE); // YYYY-MM-DDTHH:mm
  const [ymd, time] = local.split("T") as [string, string];
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return { day: { y, m, d }, time };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Instante UTC do dia civil `day` no horário `time` (HH:mm), em São Paulo. */
function at(day: CivilDate, time: string): Date {
  return localToUtc(`${day.y}-${pad(day.m)}-${pad(day.d)}T${time}`, NOTICE_TIMEZONE);
}

function addDays(day: CivilDate, n: number): CivilDate {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** 0 = segunda ... 6 = domingo (como `datetime.weekday()` do Python). */
function weekday(day: CivilDate): number {
  return (new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay() + 6) % 7;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Primeira ocorrência depois de `after` (null = a primeira de todas, podendo ser o próprio
 * `first`), nunca antes de `first`, respeitando `end`. O horário é sempre o de `first`,
 * no fuso America/Sao_Paulo. Porta de `proxima_ocorrencia` do daily.
 */
export function nextOccurrence(after: Date | null, first: Date, rec: NoticeRecurrence, end: Date | null): Date | null {
  let cand: Date | null;
  if (rec.tipo === "nenhuma") {
    cand = after === null || first.getTime() > after.getTime() ? first : null;
  } else {
    const f = civilOf(first);
    let day: CivilDate;
    if (after === null) {
      day = f.day;
    } else {
      // o próprio dia de `after` no horário de `first`; se esse horário já passou, o dia seguinte
      day = civilOf(after).day;
      if (at(day, f.time).getTime() <= after.getTime()) day = addDays(day, 1);
    }
    if (at(day, f.time).getTime() < first.getTime()) day = f.day; // `after` anterior ao primeiro envio
    cand = firstValid(day, f.time, rec);
  }
  if (cand !== null && end !== null && cand.getTime() > end.getTime()) return null;
  return cand;
}

/** Avança `day` dia a dia (ou mês a mês no mensal) até casar com a regra. */
function firstValid(day: CivilDate, time: string, rec: Exclude<NoticeRecurrence, { tipo: "nenhuma" }>): Date {
  if (rec.tipo === "diaria") return at(day, time);
  if (rec.tipo === "semanal") {
    const dias = [...new Set(rec.dias.map(Number))].sort();
    if (dias.length === 0) throw new Error("recorrência semanal sem dias");
    let d = day;
    for (let i = 0; i < 7; i++) {
      if (dias.includes(weekday(d))) return at(d, time);
      d = addDays(d, 1);
    }
    throw new Error("inalcançável");
  }
  // mensal
  let { y, m } = day;
  const start = at(day, time).getTime();
  for (let i = 0; i < 14; i++) {
    const last = daysInMonth(y, m);
    const d = rec.dia === "ultimo" ? last : Math.min(Number(rec.dia), last);
    const c = at({ y, m, d }, time);
    if (c.getTime() >= start) return c;
    m += 1;
    if (m === 13) { m = 1; y += 1; }
  }
  throw new Error("recorrência mensal inválida");
}
```

- [ ] **Step 4: Rodar — deve passar** — `pnpm --filter @fsp/core test` → `7` testes novos verdes. Os testes são a especificação: se um falhar, corrija a função, não o teste.

- [ ] **Step 4b: Compilar o core** — Run: `pnpm --filter @fsp/core build`
Expected: `dist/whatsapp-notices.js` e `dist/whatsapp-notices.d.ts` gerados. Necessário antes da Task 4 (o script de importação carrega `@fsp/core` compilado) e de qualquer `typecheck` de `apps/*`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/whatsapp-notices.ts packages/core/src/__tests__/whatsapp-notices.test.ts
git commit -m "feat(core): nextOccurrence — recorrência única/diária/semanal/mensal em America/Sao_Paulo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4: Script de importação dos grupos do daily

**Files:** Create `packages/db/scripts/import-whatsapp-groups.ts`; Modify `packages/db/package.json`

- [ ] **Step 1: Script** — `packages/db/scripts/import-whatsapp-groups.ts`:

```ts
/**
 * Importa os grupos WhatsApp do daily (config/unit_groups.json) para Unit.whatsappChatId,
 * casando `units[*].nome` com Unit.name sem acentos/caixa. Uso:
 *   pnpm --filter @fsp/db import:whatsapp-groups -- <caminho/unit_groups.json> [--org <organizationId>] [--force]
 * Sem --force, unidades que já têm whatsappChatId são puladas. Nomes não casados são listados dos dois lados.
 */
import { normalizeUnitName } from "@fsp/core";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

interface DailyUnit { nome: string; chat_id?: string; chat_ids?: string[] }
interface DailyFile { units: Record<string, DailyUnit> }

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("informe o caminho do unit_groups.json");
  const orgArg = args.indexOf("--org");
  const organizationId = orgArg >= 0 ? args[orgArg + 1] : undefined;
  const force = args.includes("--force");

  const daily = JSON.parse(readFileSync(file, "utf8")) as DailyFile;
  const orgs = await prisma.organization.findMany({ where: organizationId ? { id: organizationId } : {}, select: { id: true, name: true } });
  if (orgs.length !== 1) throw new Error(`esperava 1 organização, achei ${orgs.length}; use --org <id>`);
  const org = orgs[0]!;
  const units = await prisma.unit.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, whatsappChatId: true } });
  const byKey = new Map(units.map((u) => [normalizeUnitName(u.name), u]));

  const matched: string[] = [], skipped: string[] = [], unmatched: string[] = [];
  const used = new Set<string>();
  for (const [erpId, du] of Object.entries(daily.units)) {
    // O Publicador guarda UM chat por unidade (decisão: todos os mapeamentos atuais são únicos).
    // O daily aceita chat_id + chat_ids (lista): se houver mais de um, usa o primeiro e AVISA.
    const chats = [du.chat_id, ...(du.chat_ids ?? [])].filter((c): c is string => Boolean(c));
    const chat = chats[0];
    if (chats.length > 1) console.warn(`AVISO: #${erpId} ${du.nome} tem ${chats.length} chats no daily (${chats.join(", ")}); só o primeiro é importado.`);
    const unit = byKey.get(normalizeUnitName(du.nome));
    if (!unit || !chat) { unmatched.push(`#${erpId} ${du.nome}${chat ? "" : " (sem chat_id)"}`); continue; }
    used.add(unit.id);
    if (unit.whatsappChatId && !force) { skipped.push(`${unit.name} (já tem ${unit.whatsappChatId})`); continue; }
    await prisma.unit.update({ where: { id: unit.id }, data: { whatsappChatId: chat } });
    matched.push(`${unit.name} <- ${chat}`);
  }
  const leftover = units.filter((u) => !used.has(u.id)).map((u) => u.name);
  console.log(`Organização: ${org.name}`);
  console.log(`\nPreenchidas (${matched.length}):\n  ${matched.join("\n  ") || "-"}`);
  console.log(`\nPuladas, já tinham chat (${skipped.length}):\n  ${skipped.join("\n  ") || "-"}`);
  console.log(`\nNÃO casadas no daily (${unmatched.length}):\n  ${unmatched.join("\n  ") || "-"}`);
  console.log(`\nUnidades do Publicador sem correspondente (${leftover.length}):\n  ${leftover.join("\n  ") || "-"}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Script npm** — em `packages/db/package.json`, `scripts`, após `"seed"`: `"import:whatsapp-groups": "dotenv -e ../../.env -- tsx scripts/import-whatsapp-groups.ts"`.

- [ ] **Step 3: Rodar contra o banco local (seed)** — `pnpm --filter @fsp/db seed` (se ainda não rodou) e `pnpm --filter @fsp/db import:whatsapp-groups -- "D:/Dev/Barbearia VIP/daily/config/unit_groups.json"`
Expected: `Preenchidas (0)`, `NÃO casadas no daily (29)` (as unidades do seed têm outros nomes), `Unidades do Publicador sem correspondente (3)`. Crie uma unidade "Florianópolis - SC 401" na UI, rode de novo: `Preenchidas (1)`. Rodar uma terceira vez: aparece em `Puladas`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/scripts/import-whatsapp-groups.ts packages/db/package.json
git commit -m "feat(db): script de importação dos grupos WhatsApp do daily (unit_groups.json)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 5: Teste de autorização (`requireAdmin` → 403)

**Files:** Create `apps/web/src/lib/authz.test.ts`

- [ ] **Step 1: Teste**

```ts
import { describe, expect, it } from "vitest";
import { isAdmin, requireAdmin } from "./authz";
import type { SessionUser } from "./session";

const base: Omit<SessionUser, "role"> = { userId: "u1", organizationId: "o1", email: "x@y.z", name: null };

describe("requireAdmin", () => {
  it("MANAGER recebe 403", () => {
    expect(isAdmin({ ...base, role: "MANAGER" })).toBe(false);
    expect(() => requireAdmin({ ...base, role: "MANAGER" })).toThrow(expect.objectContaining({ status: 403 }));
  });
  it("OWNER passa", () => {
    expect(isAdmin({ ...base, role: "OWNER" })).toBe(true);
    expect(() => requireAdmin({ ...base, role: "OWNER" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Rodar — deve passar já** (o helper existe): `pnpm --filter @fsp/web test -- authz` → `2 passed`. Este teste fixa o contrato que as rotas da Task 13 usam.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/authz.test.ts
git commit -m "test(web): requireAdmin devolve 403 para gestor

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Chunk 2: Fila + conector WAHA + job do worker

### Task 6: Helpers de fila em `packages/queue`

**Files:** Modify `packages/queue/src/index.ts`, `packages/queue/src/__tests__/queue.test.ts`

- [ ] **Step 1: Teste** — acrescente a `packages/queue/src/__tests__/queue.test.ts` (reaproveita o `fakeQueue` do arquivo; ajuste o tipo de `add` para aceitar `data: unknown`):

```ts
import { dequeueNotice, enqueueNotice, hasNoticeJob } from "../index.js";

describe("enqueueNotice", () => {
  const now = new Date("2026-10-25T17:00:00Z");
  const occ = new Date("2026-10-25T18:00:00Z");
  it("jobId por aviso/ocorrência/tentativa, delay até a ocorrência, payload com ISO", async () => {
    const { queue, jobs } = fakeQueue();
    await enqueueNotice(queue, "n1", occ, 0, now);
    const job = jobs.get("whatsapp-notice-n1-1792951200000-0");
    expect(job?.opts.delay).toBe(3_600_000);
    expect(job?.data).toEqual({ noticeId: "n1", occurrenceAt: "2026-10-25T18:00:00.000Z" });
    expect(await hasNoticeJob(queue, "n1", occ, 0)).toBe(true);
    expect(await hasNoticeJob(queue, "n1", occ, 1)).toBe(false);
  });
  it("runAt explícito (retentativa) e remoção", async () => {
    const { queue, jobs } = fakeQueue();
    await enqueueNotice(queue, "n1", occ, 1, now, new Date("2026-10-25T18:03:00Z"));
    expect(jobs.get("whatsapp-notice-n1-1792951200000-1")?.opts.delay).toBe(3_780_000);
    expect(await dequeueNotice(queue, "n1", occ, 1)).toBe(true);
    expect(jobs.size).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar — deve falhar** — `pnpm --filter @fsp/queue test`.

- [ ] **Step 3: Implementar** — em `packages/queue/src/index.ts`: no import de `@fsp/core` acrescente `WHATSAPP_NOTICE_JOB_NAME, noticeJobId, type WhatsappNoticeJobData`; reexporte `export { WHATSAPP_NOTICE_JOB_NAME } from "@fsp/core"; export type { WhatsappNoticeJobData } from "@fsp/core";`; em `PublishQueueLike.add` troque o tipo de `data` para `PublishJobData | WhatsappNoticeJobData` (os fakes dos testes existentes continuam válidos); em `AppJobData` acrescente `| WhatsappNoticeJobData`. Ao final do arquivo:

```ts
/**
 * Enfileira uma ocorrência de aviso WhatsApp. `attempt` = consecutiveFailures no momento (0 na
 * primeira vez): BullMQ ignora `add` com jobId repetido, então cada retentativa tem id próprio.
 * `runAt` padrão = a própria ocorrência; a retentativa passa agora + 60 s.
 */
export async function enqueueNotice(queue: PublishQueueLike, noticeId: string, occurrenceAt: Date, attempt: number, now: Date = new Date(), runAt: Date = occurrenceAt): Promise<void> {
  const data: WhatsappNoticeJobData = { noticeId, occurrenceAt: occurrenceAt.toISOString() };
  await queue.add(WHATSAPP_NOTICE_JOB_NAME, data, { jobId: noticeJobId(noticeId, occurrenceAt, attempt), delay: delayUntil(runAt, now), attempts: 1, removeOnComplete: true, removeOnFail: true });
}

/** Remove o job pendente de uma ocorrência (pausar/cancelar/editar). Não remove job ativo. */
export async function dequeueNotice(queue: PublishQueueLike, noticeId: string, occurrenceAt: Date, attempt: number): Promise<boolean> {
  const job = await queue.getJob(noticeJobId(noticeId, occurrenceAt, attempt));
  if (!job) return false;
  if ((await job.getState()) === "active") return false;
  await job.remove();
  return true;
}

export async function hasNoticeJob(queue: PublishQueueLike, noticeId: string, occurrenceAt: Date, attempt: number): Promise<boolean> {
  return Boolean(await queue.getJob(noticeJobId(noticeId, occurrenceAt, attempt)));
}
```

`removeOnComplete: true` aqui é proposital: o job some ao terminar e a reconciliação enxerga "sem job" só quando realmente falta.

- [ ] **Step 4: Rodar — deve passar** — `pnpm -r --filter "./packages/*" build && pnpm --filter @fsp/queue test` → suíte verde.

- [ ] **Step 5: Commit**

```bash
git add packages/queue/src/index.ts packages/queue/src/__tests__/queue.test.ts
git commit -m "feat(queue): enqueueNotice/dequeueNotice/hasNoticeJob com jobId por ocorrência e tentativa

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 7: Conector WAHA em `packages/connectors`

**Files:** Create `packages/connectors/src/waha.ts`, `packages/connectors/src/__tests__/waha.test.ts`; Modify `packages/connectors/src/index.ts`

- [ ] **Step 1: Teste** — `packages/connectors/src/__tests__/waha.test.ts` (usa o `fakeFetch` de `./helpers.js`):

```ts
import { describe, expect, it } from "vitest";
import { WahaClient } from "../waha.js";
import { fakeFetch } from "./helpers.js";

const cfg = { baseUrl: "http://waha:3000/", apiKey: "K", session: "default" };
const noSleep = async () => {};

describe("WahaClient.sendText", () => {
  it("POST /api/sendText com session/chatId/text e X-Api-Key; true em 2xx", async () => {
    const { fetch, calls } = fakeFetch([() => ({ json: { id: "msg1" } })]);
    const ok = await new WahaClient(cfg, { fetch, sleep: noSleep }).sendText("a@g.us", "Olá *time*");
    expect(ok).toBe(true);
    expect(calls[0]?.url).toBe("http://waha:3000/api/sendText");
    expect(calls[0]?.headers["X-Api-Key"]).toBe("K");
    expect(calls[0]?.body).toEqual({ session: "default", chatId: "a@g.us", text: "Olá *time*" });
  });
  it("sem apiKey não manda o header", async () => {
    const { fetch, calls } = fakeFetch([() => ({ json: {} })]);
    await new WahaClient({ ...cfg, apiKey: undefined }, { fetch, sleep: noSleep }).sendText("a@g.us", "x");
    expect(calls[0]?.headers["X-Api-Key"]).toBeUndefined();
  });
  it("falha nas 2 tentativas devolve false sem lançar (HTTP 500 e depois rede)", async () => {
    const { fetch, calls } = fakeFetch([() => ({ status: 500, json: { error: "x" } }), () => { throw new TypeError("fetch failed"); }]);
    const ok = await new WahaClient(cfg, { fetch, sleep: noSleep }).sendText("a@g.us", "x");
    expect(ok).toBe(false);
    expect(calls).toHaveLength(2);
  });
  it("2a tentativa salva o envio", async () => {
    const { fetch } = fakeFetch([() => ({ status: 503 }), () => ({ json: {} })]);
    expect(await new WahaClient(cfg, { fetch, sleep: noSleep }).sendText("a@g.us", "x")).toBe(true);
  });
  it("fromEnv exige WAHA_URL", () => {
    expect(WahaClient.fromEnv({})).toBeNull();
    expect(WahaClient.fromEnv({ WAHA_URL: "http://w", WAHA_SESSION: "s1" })?.session).toBe("s1");
  });
});
```

- [ ] **Step 2: Rodar — deve falhar** — `pnpm --filter @fsp/connectors test`.

- [ ] **Step 3: Implementar** — `packages/connectors/src/waha.ts`:

```ts
import { defaultFetch, defaultSleep } from "./http.js";
import type { FetchLike } from "./types.js";

export interface WahaConfig {
  /** ex.: http://127.0.0.1:3000 (sem /api) */
  baseUrl: string;
  apiKey?: string | undefined;
  /** nome da sessão WAHA (padrão "default") */
  session: string;
}

export interface WahaSenderLike {
  sendText(chatId: string, text: string): Promise<boolean>;
}

const TIMEOUT_MS = 15_000;
const RETRY_WAIT_MS = 3_000;
const ATTEMPTS = 2;

/**
 * Cliente mínimo do WAHA (WhatsApp HTTP API), porta de daily/senders/waha.py:
 * POST {WAHA_URL}/api/sendText {session, chatId, text}, header X-Api-Key.
 * `sendText` NUNCA lança: devolve false após 2 tentativas (3 s entre elas).
 */
export class WahaClient implements WahaSenderLike {
  readonly session: string;
  private readonly fetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly url: string;
  private readonly apiKey: string | undefined;

  constructor(cfg: WahaConfig, options: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void> } = {}) {
    this.url = `${cfg.baseUrl.replace(/\/+$/, "")}/api/sendText`;
    this.apiKey = cfg.apiKey || undefined;
    this.session = cfg.session;
    this.fetch = options.fetch ?? defaultFetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** null quando WAHA_URL não está configurada (envio desabilitado). */
  static fromEnv(env: Record<string, string | undefined> = process.env): WahaClient | null {
    if (!env.WAHA_URL) return null;
    return new WahaClient({ baseUrl: env.WAHA_URL, apiKey: env.WAHA_API_KEY, session: env.WAHA_SESSION || "default" });
  }

  async sendText(chatId: string, text: string): Promise<boolean> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["X-Api-Key"] = this.apiKey;
    const body = JSON.stringify({ session: this.session, chatId, text });
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const res = await this.fetch(this.url, { method: "POST", headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (res.ok) return true;
      } catch {
        // rede/timeout: tenta de novo
      }
      if (attempt < ATTEMPTS) await this.sleep(RETRY_WAIT_MS);
    }
    return false;
  }
}
```

Em `packages/connectors/src/index.ts` acrescente `export * from "./waha.js";`.

- [ ] **Step 4: Rodar — deve passar** — `pnpm --filter @fsp/connectors test` → 5 novos verdes. (`AbortSignal.timeout` existe no Node 22 e nos tipos `@types/node` já usados pelo pacote.)

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/waha.ts packages/connectors/src/__tests__/waha.test.ts packages/connectors/src/index.ts
git commit -m "feat(connectors): cliente WAHA (sendText com 2 tentativas, nunca lança)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 8: `processNotice` + `reconcileNotices` no worker (fila/repo/sender falsos)

**Files:** Create `apps/worker/src/whatsapp-notices.ts`, `apps/worker/src/__tests__/whatsapp-notices.test.ts`

- [ ] **Step 1: Teste** — `apps/worker/src/__tests__/whatsapp-notices.test.ts` (casos de `daily/tests/test_agendamentos_job.py`):

```ts
import { localToUtc, type DeliveryStatus } from "@fsp/core";
import type { PublishQueueLike } from "@fsp/queue";
import { describe, expect, it } from "vitest";
import { processNotice, reconcileNotices, type NoticeDeps, type NoticeRecord, type NoticeRepository } from "../whatsapp-notices.js";

const sp = (l: string) => localToUtc(l, "America/Sao_Paulo");
const T0 = sp("2026-10-25T15:00");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

function fakeQueue() {
  const jobs = new Map<string, { data: unknown; delay: number }>();
  const queue: PublishQueueLike = {
    async add(_n, data, opts) { const id = String(opts?.jobId); if (!jobs.has(id)) jobs.set(id, { data, delay: Number(opts?.delay ?? 0) }); return {}; },
    async getJob(id) { return jobs.has(id) ? { async remove() { jobs.delete(id); }, async getState() { return "delayed"; } } : undefined; },
  };
  return { queue, jobs };
}

interface Row { status: DeliveryStatus; chatId: string; name: string; error?: string | undefined }

/** Repositório em memória com um único aviso. */
function fakeRepo(over: Partial<NoticeRecord> = {}, chats: Record<string, string | null> = { u61: "a@g.us", u63: "b@g.us" }) {
  const notice: NoticeRecord = {
    id: "n1", organizationId: "o1", text: "oi", targets: { unidades: ["u61", "u63"], todas: false, franqueadora: false },
    firstSendAt: T0, recurrence: { tipo: "diaria" }, endAt: null, nextRunAt: T0, state: "ativo", consecutiveFailures: 0, sendingStartedAt: null, ...over,
  };
  const rows = new Map<string, Row>(); // key = occurrence|chatId
  let clock = () => new Date(); // relógio do "banco" (sendingStartedAt/updatedAt); setClock() congela
  let updatedAt = new Date(0);
  const repo: NoticeRepository = {
    async loadNotice(id) { return id === notice.id ? { ...notice } : null; },
    async claim(id, occ) {
      if (id !== notice.id || notice.state !== "ativo" || notice.nextRunAt?.getTime() !== occ.getTime()) return false;
      notice.state = "enviando"; notice.sendingStartedAt = clock(); updatedAt = clock(); return true;
    },
    async listUnitChats() { return Object.entries(chats).map(([id, chat]) => ({ id, name: id, whatsappChatId: chat })); },
    async franchisorChatId() { return "f@g.us"; },
    async sentChatIds(_id, occ) { return new Set([...rows.entries()].filter(([k, r]) => k.startsWith(occ.toISOString()) && r.status === "enviado").map(([, r]) => r.chatId)); },
    async recordDelivery(d) { rows.set(`${d.occurrenceAt.toISOString()}|${d.chatId}`, { status: d.status, chatId: d.chatId, name: d.targetName, error: d.error }); },
    async finishCycle(id, patch) {
      if (id !== notice.id || notice.state !== "enviando") return false;
      Object.assign(notice, patch, { sendingStartedAt: null }); updatedAt = clock(); return true;
    },
    async touchSending(id) { if (id === notice.id && notice.state === "enviando") notice.sendingStartedAt = clock(); },
    async listStaleSending(before) { return notice.state === "enviando" && (notice.sendingStartedAt === null || notice.sendingStartedAt.getTime() < before.getTime()) ? [{ id: notice.id }] : []; },
    async releaseStale(id) { if (id === notice.id && notice.state === "enviando") { notice.state = "ativo"; notice.sendingStartedAt = null; } },
    async listActive(updatedBefore) { return notice.state === "ativo" && notice.nextRunAt && updatedAt.getTime() < updatedBefore.getTime() ? [{ id: notice.id, nextRunAt: notice.nextRunAt, consecutiveFailures: notice.consecutiveFailures }] : []; },
  };
  return { repo, notice, rows: () => [...rows.values()], setClock: (d: Date) => { clock = () => d; } };
}

type Deps = NoticeDeps & { sent: string[]; sleeps: number[] };
function deps(repo: NoticeRepository, queue: PublishQueueLike, send: (chat: string) => boolean, now: Date): Deps {
  const sent: string[] = [];
  const sleeps: number[] = [];
  return { repo, queue, sender: { async sendText(chat) { sent.push(chat); return send(chat); } }, now: () => now, sleep: async (ms) => { sleeps.push(ms); }, sent, sleeps };
}

describe("processNotice", () => {
  it("envia o vencido, grava enviado por destino, avança e enfileira a próxima ocorrência", async () => {
    const { repo, notice, rows } = fakeRepo();
    const { queue, jobs } = fakeQueue();
    const d = deps(repo, queue, () => true, min(1));
    const out = await processNotice(d, { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(out).toEqual({ outcome: "sent", sent: 2, failed: 0 });
    expect(d.sent).toEqual(["a@g.us", "b@g.us"]);
    expect(notice.state).toBe("ativo");
    expect(notice.nextRunAt).toEqual(sp("2026-10-26T15:00"));
    expect(rows().map((r) => r.status)).toEqual(["enviado", "enviado"]);
    expect([...jobs.keys()]).toEqual([`whatsapp-notice-n1-${sp("2026-10-26T15:00").getTime()}-0`]);
  });

  it("atraso maior que 2h marca perdido sem enviar e conclui o único", async () => {
    const { repo, notice, rows } = fakeRepo({ recurrence: { tipo: "nenhuma" } });
    const d = deps(repo, fakeQueue().queue, () => true, new Date(T0.getTime() + 3 * 3_600_000));
    const out = await processNotice(d, { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(out.outcome).toBe("missed");
    expect(d.sent).toEqual([]);
    expect(notice.state).toBe("concluido");
    expect(rows().every((r) => r.status === "perdido")).toBe(true);
  });

  it("sucesso parcial conta como ciclo ok", async () => {
    const { repo, notice, rows } = fakeRepo({ recurrence: { tipo: "nenhuma" } });
    const d = deps(repo, fakeQueue().queue, (c) => c === "a@g.us", min(1));
    await processNotice(d, { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(notice.state).toBe("concluido");
    expect(notice.consecutiveFailures).toBe(0);
    expect(rows().map((r) => r.status).sort()).toEqual(["enviado", "falhou"]);
  });

  it("três falhas pausam sem avançar, com retentativas de id 1 e 2 e linha de sistema", async () => {
    const { repo, notice, rows } = fakeRepo({ targets: { unidades: ["u61"], todas: false, franqueadora: false } });
    const { queue, jobs } = fakeQueue();
    for (let i = 0; i < 3; i++) {
      const out = await processNotice(deps(repo, queue, () => false, min(1 + i)), { noticeId: "n1", occurrenceAt: T0.toISOString() });
      expect(out.outcome).toBe(i < 2 ? "retry" : "paused");
    }
    expect(notice.state).toBe("pausado");
    expect(notice.consecutiveFailures).toBe(3);
    expect(notice.nextRunAt).toEqual(T0);
    expect([...jobs.keys()]).toEqual([`whatsapp-notice-n1-${T0.getTime()}-1`, `whatsapp-notice-n1-${T0.getTime()}-2`]);
    expect(jobs.get(`whatsapp-notice-n1-${T0.getTime()}-1`)?.delay).toBe(60_000);
    const sys = rows().find((r) => r.chatId === "-");
    expect(sys).toMatchObject({ name: "sistema", status: "pausado", error: "pausado automaticamente apos 3 falhas consecutivas" });
  });

  it("retentativa não reenvia a quem já recebeu (exceção no meio do ciclo)", async () => {
    const { repo, notice } = fakeRepo({ recurrence: { tipo: "nenhuma" } });
    const { queue } = fakeQueue();
    const d1 = deps(repo, queue, (c) => { if (c === "b@g.us") throw new Error("queda"); return true; }, min(1));
    expect((await processNotice(d1, { noticeId: "n1", occurrenceAt: T0.toISOString() })).outcome).toBe("retry");
    expect(notice.state).toBe("ativo");
    expect(notice.consecutiveFailures).toBe(1);
    const d2 = deps(repo, queue, () => true, min(2));
    await processNotice(d2, { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(d2.sent).toEqual(["b@g.us"]);
    expect(notice.state).toBe("concluido");
  });

  it("reserva falha (pausado/editado/ocorrência antiga) -> skipped, nada enviado", async () => {
    const { repo } = fakeRepo({ state: "pausado" });
    const d = deps(repo, fakeQueue().queue, () => true, min(1));
    expect(await processNotice(d, { noticeId: "n1", occurrenceAt: T0.toISOString() })).toEqual({ outcome: "skipped", reason: "não reservado" });
    expect(d.sent).toEqual([]);
  });

  it("sem destinos válidos pausa já com motivo", async () => {
    const { repo, notice, rows } = fakeRepo({}, { u61: null, u63: null });
    const out = await processNotice(deps(repo, fakeQueue().queue, () => true, min(1)), { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(out.outcome).toBe("paused");
    expect(notice.state).toBe("pausado");
    expect(rows()[0]).toMatchObject({ chatId: "-", status: "pausado", error: "sem destinos válidos" });
  });

  it("franqueadora entra como destino", async () => {
    const { repo } = fakeRepo({ targets: { unidades: [], todas: false, franqueadora: true }, recurrence: { tipo: "nenhuma" } });
    const d = deps(repo, fakeQueue().queue, () => true, min(1));
    await processNotice(d, { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(d.sent).toEqual(["f@g.us"]);
  });

  it("pausa de 1,5 s só ENTRE envios (2 destinos -> 1 sleep)", async () => {
    const { repo } = fakeRepo();
    const d = deps(repo, fakeQueue().queue, () => true, min(1));
    await processNotice(d, { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(d.sleeps).toEqual([1500]);
    const one = fakeRepo({ targets: { unidades: ["u61"], todas: false, franqueadora: false } });
    const d1 = deps(one.repo, fakeQueue().queue, () => true, min(1));
    await processNotice(d1, { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(d1.sleeps).toEqual([]);
  });

  it("heartbeat: um ciclo ainda enviando não é solto pela reconciliação", async () => {
    const { repo, notice, setClock } = fakeRepo({ state: "enviando", sendingStartedAt: min(-15) }); // reservado há 15 min (preso?)
    setClock(min(0));
    await repo.touchSending("n1"); // ...mas acabou de gravar um envio: heartbeat renova a reserva
    const out = await reconcileNotices({ repo, queue: fakeQueue().queue, now: () => min(0) });
    expect(out.staleReleased).toBe(0);
    expect(notice.state).toBe("enviando");
    const stuck = fakeRepo({ state: "enviando", sendingStartedAt: min(-15) }); // sem heartbeat: solto
    expect((await reconcileNotices({ repo: stuck.repo, queue: fakeQueue().queue, now: () => min(0) })).staleReleased).toBe(1);
    expect(stuck.notice.state).toBe("ativo");
  });

  it("carência: a reconciliação não atropela uma retentativa recém-enfileirada", async () => {
    const { repo, setClock } = fakeRepo({ targets: { unidades: ["u61"], todas: false, franqueadora: false } });
    setClock(min(1));
    const { queue, jobs } = fakeQueue();
    await processNotice(deps(repo, queue, () => false, min(1)), { noticeId: "n1", occurrenceAt: T0.toISOString() }); // falha -> retentativa id 1 (+60 s)
    expect([...jobs.keys()]).toEqual([`whatsapp-notice-n1-${T0.getTime()}-1`]);
    jobs.clear(); // simula Redis sem o job (pior caso)
    expect((await reconcileNotices({ repo, queue, now: () => min(2) })).requeued).toBe(0); // updatedAt há 1 min < OVERDUE_GRACE_MS (2 min)
    expect((await reconcileNotices({ repo, queue, now: () => min(4) })).requeued).toBe(1); // passou a carência: reenfileira com a tentativa atual
    expect([...jobs.keys()]).toEqual([`whatsapp-notice-n1-${T0.getTime()}-1`]);
  });
});

describe("reconcileNotices", () => {
  it("solta presos em enviando e reenfileira ativos sem job (vencido para já, futuro para o horário)", async () => {
    const released: string[] = [];
    const repo: NoticeRepository = {
      ...fakeRepo().repo,
      async listStaleSending() { return [{ id: "stuck" }]; },
      async releaseStale(id) { released.push(id); },
      async listActive(updatedBefore) {
        expect(updatedBefore).toEqual(min(3)); // agora (min 5) - OVERDUE_GRACE_MS (2 min)
        return [{ id: "stuck", nextRunAt: T0, consecutiveFailures: 0 }, { id: "lost", nextRunAt: min(-30), consecutiveFailures: 1 }, { id: "has", nextRunAt: min(60), consecutiveFailures: 0 }, { id: "future", nextRunAt: min(120), consecutiveFailures: 0 }];
      },
    };
    const { queue, jobs } = fakeQueue();
    jobs.set(`whatsapp-notice-has-${min(60).getTime()}-0`, { data: {}, delay: 0 });
    const out = await reconcileNotices({ repo, queue, now: () => min(5) });
    expect(out).toEqual({ staleReleased: 1, requeued: 3 });
    expect(released).toEqual(["stuck"]);
    expect(jobs.get(`whatsapp-notice-lost-${min(-30).getTime()}-1`)?.delay).toBe(0);
    expect(jobs.get(`whatsapp-notice-future-${min(120).getTime()}-0`)?.delay).toBe(115 * 60_000);
    expect(jobs.size).toBe(4);
  });
});
```

- [ ] **Step 2: Rodar — deve falhar** — `pnpm --filter @fsp/worker test -- whatsapp-notices`.

- [ ] **Step 3: Implementar** — `apps/worker/src/whatsapp-notices.ts`:

```ts
import {
  NOTICE_MAX_DELAY_MS, NOTICE_MAX_FAILURES, NOTICE_RETRY_DELAY_MS, NOTICE_SEND_INTERVAL_MS, NOTICE_STALE_SENDING_MS, OVERDUE_GRACE_MS,
  nextOccurrence, resolveNoticeTargets,
  type DeliveryStatus, type NoticeRecurrence, type NoticeState, type NoticeTargets, type NoticeUnitChat, type WhatsappNoticeJobData,
} from "@fsp/core";
import type { WahaSenderLike } from "@fsp/connectors";
import { enqueueNotice, hasNoticeJob, type PublishQueueLike } from "@fsp/queue";

/** Visão do WhatsappNotice que o processador precisa. */
export interface NoticeRecord {
  id: string;
  organizationId: string;
  text: string;
  targets: NoticeTargets;
  firstSendAt: Date;
  recurrence: NoticeRecurrence;
  endAt: Date | null;
  nextRunAt: Date | null;
  state: NoticeState;
  consecutiveFailures: number;
  sendingStartedAt: Date | null;
}

export interface DeliveryInput {
  noticeId: string;
  organizationId: string;
  occurrenceAt: Date;
  chatId: string;
  targetName: string;
  status: DeliveryStatus;
  error?: string | undefined;
}

export interface NoticeRepository {
  loadNotice(id: string): Promise<NoticeRecord | null>;
  /** Passo 1: ativo + nextRunAt == occurrenceAt -> enviando (atômico). false se não elegível. */
  claim(id: string, occurrenceAt: Date): Promise<boolean>;
  listUnitChats(organizationId: string): Promise<NoticeUnitChat[]>;
  franchisorChatId(organizationId: string): Promise<string | null>;
  /** chats com status "enviado" nesta ocorrência (retentativa não reenvia). */
  sentChatIds(noticeId: string, occurrenceAt: Date): Promise<Set<string>>;
  /** upsert pela chave (noticeId, occurrenceAt, chatId). */
  recordDelivery(d: DeliveryInput): Promise<void>;
  /** Fecha o ciclo só se ainda está `enviando`. */
  finishCycle(id: string, patch: { state: NoticeState; nextRunAt: Date | null; consecutiveFailures: number }): Promise<boolean>;
  /** Heartbeat: renova `sendingStartedAt` enquanto o ciclo grava envios (só se ainda `enviando`). */
  touchSending(id: string): Promise<void>;
  listStaleSending(before: Date): Promise<Array<{ id: string }>>;
  releaseStale(id: string): Promise<void>;
  /** `ativo` com nextRunAt e `updatedAt < updatedBefore` (carência: não atropela um job recém-enfileirado). */
  listActive(updatedBefore: Date): Promise<Array<{ id: string; nextRunAt: Date; consecutiveFailures: number }>>;
}

export interface NoticeDeps {
  repo: NoticeRepository;
  queue: PublishQueueLike;
  /** null quando WAHA_URL não está configurada: todo envio conta como falha. */
  sender: WahaSenderLike | null;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export type NoticeOutcome =
  | { outcome: "sent"; sent: number; failed: number }
  | { outcome: "missed" }
  | { outcome: "retry"; attempt: number }
  | { outcome: "paused"; reason: string }
  | { outcome: "skipped"; reason: string };

const PAUSE_AFTER_FAILURES = "pausado automaticamente apos 3 falhas consecutivas";
const NO_TARGETS = "sem destinos válidos";

/** Passos 1–5 da spec §5.2 (porta de `_processar_um` do daily). */
export async function processNotice(deps: NoticeDeps, data: WhatsappNoticeJobData): Promise<NoticeOutcome> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const occurrenceAt = new Date(data.occurrenceAt);

  const notice = await deps.repo.loadNotice(data.noticeId);
  if (!notice) return { outcome: "skipped", reason: "aviso inexistente" };
  if (!(await deps.repo.claim(notice.id, occurrenceAt))) return { outcome: "skipped", reason: "não reservado" };
  const meta = { noticeId: notice.id, occurrenceAt: data.occurrenceAt };

  const advance = async (): Promise<NoticeState> => {
    const next = nextOccurrence(occurrenceAt, notice.firstSendAt, notice.recurrence, notice.endAt);
    const state: NoticeState = next ? "ativo" : "concluido";
    if (await deps.repo.finishCycle(notice.id, { state, nextRunAt: next, consecutiveFailures: 0 }) && next) {
      await enqueueNotice(deps.queue, notice.id, next, 0, now());
    }
    return state;
  };
  const fail = async (reason: string, forcePause = false): Promise<NoticeOutcome> => {
    const failures = notice.consecutiveFailures + 1;
    const pause = forcePause || failures >= NOTICE_MAX_FAILURES;
    const done = await deps.repo.finishCycle(notice.id, { state: pause ? "pausado" : "ativo", nextRunAt: occurrenceAt, consecutiveFailures: failures });
    if (!done) return { outcome: "skipped", reason: "estado mudou durante o envio" };
    if (pause) {
      await deps.repo.recordDelivery({ noticeId: notice.id, organizationId: notice.organizationId, occurrenceAt, chatId: "-", targetName: "sistema", status: "pausado", error: forcePause ? reason : PAUSE_AFTER_FAILURES });
      log("notice paused", { ...meta, reason });
      return { outcome: "paused", reason };
    }
    await enqueueNotice(deps.queue, notice.id, occurrenceAt, failures, now(), new Date(now().getTime() + NOTICE_RETRY_DELAY_MS));
    log("notice retry", { ...meta, attempt: failures, reason });
    return { outcome: "retry", attempt: failures };
  };

  try {
    const targets = resolveNoticeTargets(notice.targets, await deps.repo.listUnitChats(notice.organizationId), await deps.repo.franchisorChatId(notice.organizationId));

    // 2. Atraso > 2h: registra perdido por destino e não envia
    if (now().getTime() - occurrenceAt.getTime() > NOTICE_MAX_DELAY_MS) {
      for (const t of targets) await deps.repo.recordDelivery({ noticeId: notice.id, organizationId: notice.organizationId, occurrenceAt, chatId: t.chatId, targetName: t.name, status: "perdido", error: "atraso > 2h" });
      log("notice missed", { ...meta, targets: targets.length });
      await advance();
      return { outcome: "missed" };
    }
    // Sem destinos: não vai se resolver sozinho; pausa já, com motivo (uma única linha de sistema por causa do UNIQUE)
    // `return await`: uma rejeição de fail() dentro do try precisa cair no catch abaixo.
    if (targets.length === 0) return await fail(NO_TARGETS, true);

    // 3. Envia a quem ainda não recebeu esta ocorrência
    const already = await deps.repo.sentChatIds(notice.id, occurrenceAt);
    let anyOk = already.size > 0;
    let sent = 0, failed = 0, sentNow = 0;
    for (const t of targets) {
      if (already.has(t.chatId)) continue;
      if (sentNow > 0) await sleep(NOTICE_SEND_INTERVAL_MS);
      const ok = deps.sender ? await deps.sender.sendText(t.chatId, notice.text) : false;
      sentNow++;
      await deps.repo.recordDelivery({ noticeId: notice.id, organizationId: notice.organizationId, occurrenceAt, chatId: t.chatId, targetName: t.name, status: ok ? "enviado" : "falhou", error: ok ? undefined : deps.sender ? "WAHA retornou falha" : "WAHA_URL não configurada" });
      if (ok) { sent++; anyOk = true; } else failed++;
      await deps.repo.touchSending(notice.id); // heartbeat: 30 destinos x 1,5 s + 2 tentativas do WAHA passam de 10 min
    }

    // 4./5. >=1 enviado avança; todos falharam -> falha do ciclo sem avançar
    if (!anyOk) return await fail("todos os destinos falharam");
    const state = await advance();
    log("notice sent", { ...meta, sent, failed, state });
    return { outcome: "sent", sent, failed };
  } catch (err) {
    log("notice error", { ...meta, error: err instanceof Error ? err.message : String(err) });
    try {
      return await fail("exceção no envio");
    } catch (err2) {
      // Não deixa uma linha ruim derrubar o job; a reconciliação solta o `enviando` em 10 min
      log("notice error", { ...meta, error: `falha ao fechar o ciclo: ${err2 instanceof Error ? err2.message : String(err2)}` });
      return { outcome: "skipped", reason: "falha ao fechar o ciclo" };
    }
  }
}

export interface NoticeReconcileSummary {
  staleReleased: number;
  requeued: number;
}

/** Passos 0–1 da spec §5.2: solta `enviando` presos e reenfileira ativos sem job (Redis recriado etc.). */
export async function reconcileNotices(deps: { repo: NoticeRepository; queue: PublishQueueLike; now?: () => Date; log?: NoticeDeps["log"] }): Promise<NoticeReconcileSummary> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const summary: NoticeReconcileSummary = { staleReleased: 0, requeued: 0 };
  for (const n of await deps.repo.listStaleSending(new Date(now().getTime() - NOTICE_STALE_SENDING_MS))) {
    await deps.repo.releaseStale(n.id);
    summary.staleReleased++;
  }
  // Carência de OVERDUE_GRACE_MS (2 min, a mesma das publicações): um aviso que acabou de ser criado,
  // editado ou retentado (fail() enfileira +60 s) ainda pode estar sendo enfileirado pelo web/worker.
  for (const n of await deps.repo.listActive(new Date(now().getTime() - OVERDUE_GRACE_MS))) {
    if (await hasNoticeJob(deps.queue, n.id, n.nextRunAt, n.consecutiveFailures)) continue;
    const runAt = n.nextRunAt.getTime() > now().getTime() ? n.nextRunAt : now();
    await enqueueNotice(deps.queue, n.id, n.nextRunAt, n.consecutiveFailures, now(), runAt);
    summary.requeued++;
  }
  if (summary.staleReleased || summary.requeued) log("reconcile notices", { ...summary });
  return summary;
}
```

- [ ] **Step 4: Rodar — deve passar** — `pnpm -r --filter "./packages/*" build && pnpm --filter @fsp/worker test -- whatsapp-notices` → `12 passed` (11 de `processNotice`, incluindo sleep só entre envios, heartbeat e carência; 1 de `reconcileNotices`). Os testes são a especificação (vêm do daily); corrija a função, não o teste.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/whatsapp-notices.ts apps/worker/src/__tests__/whatsapp-notices.test.ts
git commit -m "feat(worker): processNotice (2h perdido, retentativa sem duplicar, 3 falhas pausam) e reconcileNotices

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 9: Repositório Prisma + despacho em `main.ts`

**Files:** Modify `apps/worker/src/repository.ts`, `apps/worker/src/main.ts`

- [ ] **Step 1: Repositório** — ao final de `apps/worker/src/repository.ts` (imports no topo: `import type { NoticeRecurrence, NoticeTargets } from "@fsp/core";` e `import type { NoticeRepository } from "./whatsapp-notices.js";`):

```ts
/** Implementação Prisma do repositório de avisos WhatsApp. */
export function prismaNoticeRepository(prisma: PrismaClient): NoticeRepository {
  return {
    async loadNotice(id) {
      const n = await prisma.whatsappNotice.findUnique({ where: { id } });
      if (!n) return null;
      return { id: n.id, organizationId: n.organizationId, text: n.text, targets: n.targets as unknown as NoticeTargets, firstSendAt: n.firstSendAt, recurrence: n.recurrence as unknown as NoticeRecurrence, endAt: n.endAt, nextRunAt: n.nextRunAt, state: n.state, consecutiveFailures: n.consecutiveFailures, sendingStartedAt: n.sendingStartedAt };
    },
    async claim(id, occurrenceAt) {
      const r = await prisma.whatsappNotice.updateMany({ where: { id, state: "ativo", nextRunAt: occurrenceAt }, data: { state: "enviando", sendingStartedAt: new Date() } });
      return r.count === 1;
    },
    async listUnitChats(organizationId) {
      return prisma.unit.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, whatsappChatId: true } });
    },
    async franchisorChatId(organizationId) {
      const o = await prisma.organization.findUnique({ where: { id: organizationId }, select: { whatsappChatId: true } });
      return o?.whatsappChatId ?? null;
    },
    async sentChatIds(noticeId, occurrenceAt) {
      const rows = await prisma.whatsappDelivery.findMany({ where: { noticeId, occurrenceAt, status: "enviado" }, select: { chatId: true } });
      return new Set(rows.map((r) => r.chatId));
    },
    async recordDelivery(d) {
      const data = { organizationId: d.organizationId, status: d.status, error: d.error ?? null, targetName: d.targetName, sentAt: new Date() };
      await prisma.whatsappDelivery.upsert({
        where: { noticeId_occurrenceAt_chatId: { noticeId: d.noticeId, occurrenceAt: d.occurrenceAt, chatId: d.chatId } },
        create: { noticeId: d.noticeId, occurrenceAt: d.occurrenceAt, chatId: d.chatId, ...data },
        update: data,
      });
    },
    async finishCycle(id, patch) {
      const r = await prisma.whatsappNotice.updateMany({ where: { id, state: "enviando" }, data: { ...patch, sendingStartedAt: null } });
      return r.count === 1;
    },
    async listStaleSending(before) {
      return prisma.whatsappNotice.findMany({ where: { state: "enviando", OR: [{ sendingStartedAt: null }, { sendingStartedAt: { lt: before } }] }, select: { id: true }, take: 500 });
    },
    async touchSending(id) {
      await prisma.whatsappNotice.updateMany({ where: { id, state: "enviando" }, data: { sendingStartedAt: new Date() } });
    },
    async releaseStale(id) {
      await prisma.whatsappNotice.updateMany({ where: { id, state: "enviando" }, data: { state: "ativo", sendingStartedAt: null } });
    },
    async listActive(updatedBefore) {
      const rows = await prisma.whatsappNotice.findMany({ where: { state: "ativo", nextRunAt: { not: null }, updatedAt: { lt: updatedBefore } }, select: { id: true, nextRunAt: true, consecutiveFailures: true }, orderBy: { nextRunAt: "asc" }, take: 2000 });
      return rows.map((r) => ({ id: r.id, nextRunAt: r.nextRunAt as Date, consecutiveFailures: r.consecutiveFailures }));
    },
  };
}
```

- [ ] **Step 2: `main.ts`** — imports: acrescente `WahaClient` ao import de `@fsp/connectors`, `WHATSAPP_NOTICE_JOB_NAME, type WhatsappNoticeJobData` ao de `@fsp/core`, `prismaNoticeRepository` ao de `./repository.js`, e `import { processNotice, reconcileNotices } from "./whatsapp-notices.js";`. Após `const reconcileRepo = ...`:

```ts
  const noticeRepo = prismaNoticeRepository(prisma);
  const waha = WahaClient.fromEnv();
  if (!waha) log("waha disabled", { reason: "WAHA_URL ausente; avisos WhatsApp falharão até configurar" });
```

No corpo do `Worker`, o ramo do reconcile passa a tratar os dois domínios, e entra o ramo do aviso:

```ts
      if (job.name === RECONCILE_JOB_NAME) {
        const targets = await reconcileTargets({ repo: reconcileRepo, queue, log: deps.log });
        const notices = await reconcileNotices({ repo: noticeRepo, queue, log: deps.log });
        return { targets, notices };
      }
      if (job.name === WHATSAPP_NOTICE_JOB_NAME) {
        return processNotice({ repo: noticeRepo, queue, sender: waha, log: deps.log }, job.data as WhatsappNoticeJobData);
      }
```

Na subida, substitua a linha `await reconcileTargets({ repo: reconcileRepo, queue, log: deps.log });` por um bloco tolerante (uma falha de reconciliação — banco ainda subindo, migration atrasada — não pode derrubar o worker; o scheduler de 5 min repete):

```ts
  // Reconcilia já na subida: retoma o que ficou preso enquanto o worker esteve fora.
  try {
    await reconcileTargets({ repo: reconcileRepo, queue, log: deps.log });
    await reconcileNotices({ repo: noticeRepo, queue, log: deps.log });
  } catch (err) {
    log("startup reconcile failed", { error: err instanceof Error ? err.message : String(err) });
  }
```

- [ ] **Step 3: Verificar** — `pnpm --filter @fsp/worker typecheck && pnpm --filter @fsp/worker test` → sem erros; suíte do worker verde. Subida local: `pnpm --filter @fsp/worker dev` → log `worker started`; sem `WAHA_URL` no `.env`, aparece `waha disabled`.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/repository.ts apps/worker/src/main.ts
git commit -m "feat(worker): job whatsapp-notice, repositório Prisma e reconciliação dos avisos na subida e a cada 5 min

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Chunk 3: Serviços + rotas de API + página `/avisos` + menu

### Task 10: Serviço `whatsapp-notices.ts` — validação e regras puras (zod + `planUpdate`)

**Files:** Create `apps/web/src/lib/services/whatsapp-notices.ts`, `apps/web/src/lib/services/whatsapp-notices.test.ts`

- [ ] **Step 1: Teste** — `apps/web/src/lib/services/whatsapp-notices.test.ts`:

```ts
import { localToUtc } from "@fsp/core";
import { describe, expect, it } from "vitest";
import { assertResolvableTargets, parseNoticeInput, planUpdate, CHAT_ID_RE } from "./whatsapp-notices";

const sp = (l: string) => localToUtc(l, "America/Sao_Paulo");
const now = sp("2026-10-23T10:00");
const base = { text: "Olá *time*", targets: { unidades: ["u1"], todas: false, franqueadora: false }, firstSendLocal: "2026-12-01T15:00", recurrence: { tipo: "nenhuma" as const } };

describe("parseNoticeInput", () => {
  it("aceita e converte horário de São Paulo para UTC", () => {
    const r = parseNoticeInput(base, now);
    expect(r.firstSendAt).toEqual(sp("2026-12-01T15:00"));
    expect(r.endAt).toBeNull();
  });
  it("endDate vira 23:59 de São Paulo", () => {
    expect(parseNoticeInput({ ...base, recurrence: { tipo: "diaria" }, endDate: "2026-12-10" }, now).endAt).toEqual(sp("2026-12-10T23:59"));
  });
  it("rejeita texto vazio, sem destino, passado, semanal sem dias, mensal inválido, fim antes do início", () => {
    expect(() => parseNoticeInput({ ...base, text: "  " }, now)).toThrow(/texto/i);
    expect(() => parseNoticeInput({ ...base, targets: { unidades: [], todas: false, franqueadora: false } }, now)).toThrow(/destino/i);
    expect(() => parseNoticeInput({ ...base, firstSendLocal: "2020-01-01T10:00" }, now)).toThrow(/futuro/i);
    expect(() => parseNoticeInput({ ...base, recurrence: { tipo: "semanal", dias: [] } }, now)).toThrow(/dia da semana/i);
    expect(() => parseNoticeInput({ ...base, recurrence: { tipo: "mensal", dia: 32 } }, now)).toThrow(/dia do mês/i);
    expect(() => parseNoticeInput({ ...base, recurrence: { tipo: "diaria" }, endDate: "2026-11-01" }, now)).toThrow(/data final/i);
  });
  it("edição: primeiro envio no passado é aceito se não mudou", () => {
    const r = parseNoticeInput({ ...base, firstSendLocal: "2026-10-01T15:00", recurrence: { tipo: "diaria" } }, now, { previousFirstSendAt: sp("2026-10-01T15:00") });
    expect(r.firstSendAt).toEqual(sp("2026-10-01T15:00"));
  });
});

describe("planUpdate (regras de edição do daily)", () => {
  const current = { state: "pausado" as const, firstSendAt: sp("2026-10-01T15:00"), recurrence: { tipo: "diaria" as const }, nextRunAt: sp("2026-10-23T15:00") };
  it("preserva pausado e recalcula a partir de agora quando a regra mudou (semanal -> próximo dia válido)", () => {
    const p = planUpdate(current, { firstSendAt: sp("2026-10-01T15:00"), recurrence: { tipo: "semanal", dias: [0] }, endAt: null }, sp("2026-10-23T16:00"));
    expect(p).toEqual({ state: "pausado", nextRunAt: sp("2026-10-26T15:00") }); // 23/10 é sexta -> segunda 26
  });
  it("sem mudança de regra e ocorrência futura, recalcula a partir de agora", () => {
    const p = planUpdate({ ...current, nextRunAt: sp("2026-10-24T15:00") }, { firstSendAt: current.firstSendAt, recurrence: current.recurrence, endAt: null }, sp("2026-10-23T16:00"));
    expect(p).toEqual({ state: "pausado", nextRunAt: sp("2026-10-24T15:00") });
  });
  it("mantém a ocorrência vencida e não enviada quando a regra não mudou", () => {
    const stale = { ...current, state: "ativo" as const, nextRunAt: sp("2026-10-23T09:00") };
    expect(planUpdate(stale, { firstSendAt: stale.firstSendAt, recurrence: stale.recurrence, endAt: null }, now)).toEqual({ state: "ativo", nextRunAt: sp("2026-10-23T09:00") });
  });
  it("fim que exclui tudo conclui", () => {
    const p = planUpdate({ ...current, state: "ativo" }, { firstSendAt: current.firstSendAt, recurrence: { tipo: "nenhuma" }, endAt: sp("2026-10-02T00:00") }, now);
    expect(p).toEqual({ state: "concluido", nextRunAt: null });
  });
  it("recorrência vinda do jsonb (chaves/dias em outra ordem) conta como a mesma regra", () => {
    const stale = { ...current, state: "ativo" as const, recurrence: JSON.parse('{"dias":[4,0],"tipo":"semanal"}') as never, nextRunAt: sp("2026-10-23T09:00") };
    expect(planUpdate(stale, { firstSendAt: stale.firstSendAt, recurrence: { tipo: "semanal", dias: [0, 4] }, endAt: null }, now)).toEqual({ state: "ativo", nextRunAt: sp("2026-10-23T09:00") });
  });
  it("enviando -> 409; concluido/cancelado -> 404", () => {
    expect(() => planUpdate({ ...current, state: "enviando" }, { firstSendAt: current.firstSendAt, recurrence: current.recurrence, endAt: null }, now)).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => planUpdate({ ...current, state: "cancelado" }, { firstSendAt: current.firstSendAt, recurrence: current.recurrence, endAt: null }, now)).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe("assertResolvableTargets (como _parse_form do daily: >= 1 destino RESOLVIDO)", () => {
  const units = [{ id: "u1", name: "A", whatsappChatId: "a@g.us" }, { id: "u2", name: "B", whatsappChatId: null }];
  it("passa com unidade com grupo, com todas, ou com franqueadora cadastrada", () => {
    expect(() => assertResolvableTargets({ unidades: ["u1"], todas: false, franqueadora: false }, units, null)).not.toThrow();
    expect(() => assertResolvableTargets({ unidades: [], todas: true, franqueadora: false }, units, null)).not.toThrow();
    expect(() => assertResolvableTargets({ unidades: [], todas: false, franqueadora: true }, units, "f@g.us")).not.toThrow();
  });
  it("400 quando nada resolve: unidade sem grupo, franqueadora sem grupo, todas sem nenhuma unidade com grupo", () => {
    expect(() => assertResolvableTargets({ unidades: ["u2"], todas: false, franqueadora: false }, units, null)).toThrow(/destino/i);
    expect(() => assertResolvableTargets({ unidades: [], todas: false, franqueadora: true }, units, null)).toThrow(/destino/i);
    expect(() => assertResolvableTargets({ unidades: [], todas: true, franqueadora: false }, [units[1]!], null)).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe("CHAT_ID_RE", () => {
  it("aceita grupo e número no formato WAHA", () => {
    expect(CHAT_ID_RE.test("120363424632069171@g.us")).toBe(true);
    expect(CHAT_ID_RE.test("554899161906-1529438950@g.us")).toBe(true);
    expect(CHAT_ID_RE.test("554899073477@c.us")).toBe(true);
    expect(CHAT_ID_RE.test("+55 48 9999-9999")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar — deve falhar** — `pnpm --filter @fsp/web test -- whatsapp-notices`.

- [ ] **Step 3: Implementar (parte pura)** — `apps/web/src/lib/services/whatsapp-notices.ts`:

```ts
import { NOTICE_TEXT_MAX, NOTICE_TIMEZONE, canTransition, localToUtc, nextOccurrence, resolveNoticeTargets, sameRecurrence, type NoticeRecurrence, type NoticeState, type NoticeTargets, type NoticeUnitChat } from "@fsp/core";
import type { Prisma, PrismaClient } from "@fsp/db";
import { dequeueNotice, enqueueNotice, type PublishQueueLike } from "@fsp/queue";
import { z } from "zod";
import { HttpError } from "../api";

/** Formato WAHA: grupo `123@g.us` / `5548...-123@g.us` ou número `55DDDN@c.us`. */
export const CHAT_ID_RE = /^\d{5,20}(-\d+)?@(g|c)\.us$/;
export const chatIdSchema = z.string().trim().regex(CHAT_ID_RE, "Formato inválido. Use 123456789@g.us (grupo) ou 5548999999999@c.us (número).").or(z.literal("")).nullable();

export const recurrenceSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("nenhuma") }),
  z.object({ tipo: z.literal("diaria") }),
  z.object({ tipo: z.literal("semanal"), dias: z.array(z.number().int().min(0).max(6)).default([]) }),
  z.object({ tipo: z.literal("mensal"), dia: z.union([z.number().int(), z.literal("ultimo")]) }),
]);

export const noticeInputSchema = z.object({
  text: z.string().max(NOTICE_TEXT_MAX),
  targets: z.object({ unidades: z.array(z.string().min(1)).default([]), todas: z.boolean().default(false), franqueadora: z.boolean().default(false) }),
  /** `YYYY-MM-DDTHH:mm` no fuso America/Sao_Paulo */
  firstSendLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Data/hora inválida."),
  recurrence: recurrenceSchema,
  /** `YYYY-MM-DD` (opcional): último dia em que pode haver envio */
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});
export type NoticeInput = z.infer<typeof noticeInputSchema>;

export interface ParsedNotice {
  text: string;
  targets: NoticeTargets;
  firstSendAt: Date;
  recurrence: NoticeRecurrence;
  endAt: Date | null;
}

/**
 * Validação da spec §5.4 (porta de `_parse_form` do daily). Em edição, `previousFirstSendAt`
 * libera um primeiro envio no passado desde que não tenha mudado.
 */
export function parseNoticeInput(raw: unknown, now: Date = new Date(), opts: { previousFirstSendAt?: Date } = {}): ParsedNotice {
  const input = noticeInputSchema.parse(raw);
  const text = input.text.trim();
  if (text.length < 1 || text.length > NOTICE_TEXT_MAX) throw new HttpError(400, `O texto deve ter entre 1 e ${NOTICE_TEXT_MAX} caracteres.`);
  const targets: NoticeTargets = { unidades: [...new Set(input.targets.unidades)], todas: input.targets.todas, franqueadora: input.targets.franqueadora };
  if (targets.unidades.length === 0 && !targets.todas && !targets.franqueadora) throw new HttpError(400, "Escolha ao menos um destino.");
  const firstSendAt = localToUtc(input.firstSendLocal, NOTICE_TIMEZONE);
  const unchanged = opts.previousFirstSendAt !== undefined && opts.previousFirstSendAt.getTime() === firstSendAt.getTime();
  if (!unchanged && firstSendAt.getTime() < now.getTime() + 60_000) throw new HttpError(400, "A data/hora do primeiro envio precisa estar no futuro.");
  const recurrence = input.recurrence;
  if (recurrence.tipo === "semanal") {
    recurrence.dias = [...new Set(recurrence.dias)].sort();
    if (recurrence.dias.length === 0) throw new HttpError(400, "Marque ao menos um dia da semana.");
  }
  if (recurrence.tipo === "mensal" && recurrence.dia !== "ultimo" && (recurrence.dia < 1 || recurrence.dia > 31)) throw new HttpError(400, "Dia do mês inválido (1 a 31 ou \"ultimo\").");
  let endAt: Date | null = null;
  if (input.endDate) {
    endAt = localToUtc(`${input.endDate}T23:59`, NOTICE_TIMEZONE);
    if (endAt.getTime() < firstSendAt.getTime()) throw new HttpError(400, "A data final precisa ser depois do primeiro envio.");
  }
  return { text, targets, firstSendAt, recurrence, endAt };
}

interface CurrentNotice { state: NoticeState; firstSendAt: Date; recurrence: NoticeRecurrence; nextRunAt: Date | null }

/**
 * Estado e próxima ocorrência após uma edição (porta de `atualizar` do daily): pausado continua
 * pausado; uma ocorrência já vencida e não enviada é mantida se a regra não mudou (não pula o
 * envio atrasado); senão recalcula a partir de agora quando o primeiro envio ficou no passado.
 */
export function planUpdate(current: CurrentNotice, next: Pick<ParsedNotice, "firstSendAt" | "recurrence" | "endAt">, now: Date = new Date()): { state: NoticeState; nextRunAt: Date | null } {
  if (current.state === "enviando") throw new HttpError(409, "Este aviso está sendo enviado agora; aguarde e tente de novo.");
  if (current.state !== "ativo" && current.state !== "pausado") throw new HttpError(404, "Aviso não encontrado.");
  // sameRecurrence, nunca JSON.stringify: o jsonb do Postgres devolve as chaves em outra ordem
  const sameRule = current.firstSendAt.getTime() === next.firstSendAt.getTime() && sameRecurrence(current.recurrence, next.recurrence);
  let nextRunAt: Date | null;
  if (current.nextRunAt && current.nextRunAt.getTime() <= now.getTime() && sameRule) {
    nextRunAt = next.endAt === null || current.nextRunAt.getTime() <= next.endAt.getTime() ? current.nextRunAt : null;
  } else {
    nextRunAt = nextOccurrence(next.firstSendAt.getTime() < now.getTime() ? now : null, next.firstSendAt, next.recurrence, next.endAt);
  }
  return { state: nextRunAt ? current.state : "concluido", nextRunAt };
}

/**
 * Como `_parse_form` do daily: o destino precisa RESOLVER em ao menos um chat (unidade com
 * grupo cadastrado ou franqueadora com grupo). Marcar "todas" com nenhuma unidade com chat é erro.
 */
export function assertResolvableTargets(targets: NoticeTargets, units: readonly NoticeUnitChat[], franchisorChatId: string | null): void {
  if (resolveNoticeTargets(targets, units, franchisorChatId).length === 0) throw new HttpError(400, "Escolha ao menos um destino.");
}
```

- [ ] **Step 4: Rodar — deve passar** — `pnpm --filter @fsp/web test -- whatsapp-notices` → 13 testes verdes (4 `parseNoticeInput`, 6 `planUpdate`, 2 `assertResolvableTargets`, 1 `CHAT_ID_RE`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/services/whatsapp-notices.ts apps/web/src/lib/services/whatsapp-notices.test.ts
git commit -m "feat(web): validação e regras de edição dos Avisos WhatsApp (zod, planUpdate)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 11: Serviço — CRUD com Prisma e fila, transições, teste imediato

**Files:** Modify `apps/web/src/lib/services/whatsapp-notices.ts`

- [ ] **Step 1: Acrescentar ao serviço** (abaixo de `planUpdate`; `import type { WahaSenderLike } from "@fsp/connectors";` no topo):

```ts
export interface NoticeDeps { prisma: PrismaClient; queue: PublishQueueLike }

async function assertUnitsInOrg(prisma: PrismaClient, organizationId: string, unitIds: string[]) {
  if (unitIds.length === 0) return;
  const count = await prisma.unit.count({ where: { id: { in: unitIds }, organizationId } });
  if (count !== unitIds.length) throw new HttpError(400, "Uma ou mais unidades não pertencem à sua rede.");
}

const noticeSelect = { id: true, text: true, targets: true, firstSendAt: true, recurrence: true, endAt: true, nextRunAt: true, state: true, consecutiveFailures: true, createdAt: true, updatedAt: true } as const;

export async function listNotices(prisma: PrismaClient, organizationId: string) {
  return prisma.whatsappNotice.findMany({ where: { organizationId, state: { in: ["ativo", "pausado", "enviando"] } }, orderBy: [{ nextRunAt: "asc" }], select: noticeSelect });
}

export async function listDeliveries(prisma: PrismaClient, organizationId: string, limit = 200) {
  return prisma.whatsappDelivery.findMany({ where: { organizationId }, orderBy: { sentAt: "desc" }, take: limit, select: { id: true, occurrenceAt: true, sentAt: true, chatId: true, targetName: true, status: true, error: true, notice: { select: { id: true, text: true } } } });
}

/** Os chats de hoje (unidades + franqueadora) para validar que o destino resolve em >= 1 chat. */
async function loadChats(prisma: PrismaClient, organizationId: string) {
  const [units, org] = await Promise.all([
    prisma.unit.findMany({ where: { organizationId }, select: { id: true, name: true, whatsappChatId: true } }),
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { whatsappChatId: true } }),
  ]);
  return { units, franchisorChatId: org.whatsappChatId };
}

/** Campos Json do Prisma: `NoticeTargets`/`NoticeRecurrence` são aliases de objeto, atribuíveis a `InputJsonValue`. */
const json = (v: NoticeTargets | NoticeRecurrence) => v as unknown as Prisma.InputJsonObject;

export async function createNotice(deps: NoticeDeps, organizationId: string, userId: string, raw: unknown) {
  const input = parseNoticeInput(raw);
  await assertUnitsInOrg(deps.prisma, organizationId, input.targets.unidades);
  const chats = await loadChats(deps.prisma, organizationId);
  assertResolvableTargets(input.targets, chats.units, chats.franchisorChatId);
  const nextRunAt = nextOccurrence(null, input.firstSendAt, input.recurrence, input.endAt);
  const notice = await deps.prisma.whatsappNotice.create({
    data: { organizationId, text: input.text, targets: json(input.targets), firstSendAt: input.firstSendAt, recurrence: json(input.recurrence), endAt: input.endAt, nextRunAt, state: nextRunAt ? "ativo" : "concluido", createdById: userId },
    select: noticeSelect,
  });
  // Enfileira fora da transação: se falhar, a reconciliação (5 min) recupera pelo banco.
  if (nextRunAt) await enqueueNotice(deps.queue, notice.id, nextRunAt, 0);
  return notice;
}

export async function updateNotice(deps: NoticeDeps, organizationId: string, noticeId: string, raw: unknown) {
  const current = await deps.prisma.whatsappNotice.findFirst({ where: { id: noticeId, organizationId } });
  if (!current) throw new HttpError(404, "Aviso não encontrado.");
  const input = parseNoticeInput(raw, new Date(), { previousFirstSendAt: current.firstSendAt });
  await assertUnitsInOrg(deps.prisma, organizationId, input.targets.unidades);
  const chats = await loadChats(deps.prisma, organizationId);
  assertResolvableTargets(input.targets, chats.units, chats.franchisorChatId);
  const plan = planUpdate({ state: current.state, firstSendAt: current.firstSendAt, recurrence: current.recurrence as unknown as NoticeRecurrence, nextRunAt: current.nextRunAt }, input);
  // O estado é decidido no próprio UPDATE: se outra requisição pausou/retomou no meio, prevalece o banco.
  const r = await deps.prisma.whatsappNotice.updateMany({
    where: { id: noticeId, state: { in: ["ativo", "pausado"] } },
    data: { text: input.text, targets: json(input.targets), firstSendAt: input.firstSendAt, recurrence: json(input.recurrence), endAt: input.endAt, nextRunAt: plan.nextRunAt, consecutiveFailures: 0, ...(plan.state === "concluido" ? { state: "concluido" as const } : {}) },
  });
  if (r.count === 0) throw new HttpError(409, "Este aviso mudou de estado; recarregue a página.");
  if (current.nextRunAt) await dequeueNotice(deps.queue, noticeId, current.nextRunAt, current.consecutiveFailures).catch(() => false);
  const updated = await deps.prisma.whatsappNotice.findUniqueOrThrow({ where: { id: noticeId }, select: noticeSelect });
  if (updated.state === "ativo" && updated.nextRunAt) await enqueueNotice(deps.queue, noticeId, updated.nextRunAt, 0);
  return updated;
}

/** Pausar / retomar / cancelar pela tela (lista branca da spec §5.3). */
export async function changeNoticeState(deps: NoticeDeps, organizationId: string, noticeId: string, to: "ativo" | "pausado" | "cancelado") {
  const current = await deps.prisma.whatsappNotice.findFirst({ where: { id: noticeId, organizationId } });
  if (!current) throw new HttpError(404, "Aviso não encontrado.");
  if (!canTransition(current.state, to)) throw new HttpError(409, `Não é possível mudar de ${current.state} para ${to}.`);
  // Retomar zera o contador: senão um aviso pausado por 3 falhas pausa de novo na 1ª falha
  const r = await deps.prisma.whatsappNotice.updateMany({ where: { id: noticeId, state: current.state }, data: { state: to, ...(to === "ativo" ? { consecutiveFailures: 0 } : {}) } });
  if (r.count === 0) throw new HttpError(409, "Este aviso mudou de estado; recarregue a página.");
  if (current.nextRunAt) {
    if (to === "ativo") await enqueueNotice(deps.queue, noticeId, current.nextRunAt, 0); // vencido? a regra das 2h decide no worker
    else await dequeueNotice(deps.queue, noticeId, current.nextRunAt, current.consecutiveFailures).catch(() => false);
  }
}

/** "Enviar teste para mim": imediato, só para o User.whatsappChatId do próprio usuário. */
export async function sendTestNotice(prisma: PrismaClient, sender: WahaSenderLike | null, userId: string, raw: unknown) {
  const { text } = z.object({ text: z.string().trim().min(1, "Escreva o texto antes de testar.").max(NOTICE_TEXT_MAX) }).parse(raw);
  if (!sender) throw new HttpError(503, "Envio de WhatsApp não configurado (WAHA_URL).");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { whatsappChatId: true } });
  if (!user.whatsappChatId) throw new HttpError(400, "Cadastre seu número em Minha conta para receber o teste.");
  const ok = await sender.sendText(user.whatsappChatId, text);
  if (!ok) throw new HttpError(502, "Falha ao enviar o teste (WAHA).");
}

/** Dados que a página /avisos precisa. */
export async function noticePageData(prisma: PrismaClient, organizationId: string, userId: string) {
  const [units, org, me, notices, deliveries] = await Promise.all([
    prisma.unit.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, whatsappChatId: true } }),
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { whatsappChatId: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { whatsappChatId: true } }),
    listNotices(prisma, organizationId),
    listDeliveries(prisma, organizationId),
  ]);
  return { units, franchisorChatId: org.whatsappChatId, myChatId: me.whatsappChatId, notices, deliveries };
}
```

- [ ] **Step 2: Typecheck** — `pnpm --filter @fsp/web typecheck` → sem erros. (`Prisma` vem de `@fsp/db`, que faz `export * from "@prisma/client"`; `NoticeTargets` é um `type` alias justamente para ser atribuível a `InputJsonValue` — o helper `json()` só existe para o caso de a versão do Prisma exigir `InputJsonObject` explícito.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/services/whatsapp-notices.ts
git commit -m "feat(web): serviço dos Avisos WhatsApp — criar, editar, pausar/retomar/cancelar, teste imediato

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 12: Rotas de `chatId` (unidade, franqueadora, usuário) + componente `ChatIdField`

**Files:** Modify `apps/web/src/app/api/units/[id]/route.ts`; Create `apps/web/src/app/api/organization/route.ts`, `apps/web/src/app/api/account/whatsapp/route.ts`, `apps/web/src/components/ChatIdField.tsx`; Modify `apps/web/src/app/(app)/unidades/page.tsx`, `apps/web/src/app/(app)/conta/page.tsx`

- [ ] **Step 1: `PATCH /api/units/[id]`** — acrescente a `apps/web/src/app/api/units/[id]/route.ts` (imports: `import { z } from "zod"; import { chatIdSchema } from "@/lib/services/whatsapp-notices";`):

```ts
const patchSchema = z.object({ whatsappChatId: chatIdSchema });

/** Grupo WhatsApp da unidade (Avisos WhatsApp). */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireSession();
  requireAdmin(s);
  const { id } = await ctx.params;
  const input = patchSchema.parse(await req.json());
  const r = await prisma.unit.updateMany({ where: { id, organizationId: s.organizationId }, data: { whatsappChatId: input.whatsappChatId || null } });
  if (r.count === 0) throw new HttpError(404, "Unidade não encontrada.");
  return NextResponse.json({ ok: true });
});
```

(`HttpError` vem de `@/lib/api`, já importado parcialmente — ajuste o import para `{ HttpError, route }`.)

- [ ] **Step 2: `PATCH /api/organization`** — `apps/web/src/app/api/organization/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { chatIdSchema } from "@/lib/services/whatsapp-notices";
import { requireSession } from "@/lib/session";

const patchSchema = z.object({ whatsappChatId: chatIdSchema });

/** Grupo WhatsApp da franqueadora (destino "Franqueadora" dos avisos). Só administrador. */
export const PATCH = route(async (req: Request) => {
  const s = await requireSession();
  requireAdmin(s);
  const input = patchSchema.parse(await req.json());
  await prisma.organization.update({ where: { id: s.organizationId }, data: { whatsappChatId: input.whatsappChatId || null } });
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 3: `PATCH /api/account/whatsapp`** — `apps/web/src/app/api/account/whatsapp/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { chatIdSchema } from "@/lib/services/whatsapp-notices";
import { requireSession } from "@/lib/session";

/** Número do próprio usuário para "Enviar teste para mim". */
export const PATCH = route(async (req: Request) => {
  const s = await requireSession();
  const input = z.object({ whatsappChatId: chatIdSchema }).parse(await req.json());
  await prisma.user.update({ where: { id: s.userId }, data: { whatsappChatId: input.whatsappChatId || null } });
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 4: `ChatIdField`** — `apps/web/src/components/ChatIdField.tsx` (mesmo padrão de `PasswordForm`: `fetch` + `router.refresh()`):

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { IconAlert, IconCheck } from "./Icons";

interface Props {
  /** rota PATCH que recebe { whatsappChatId } */
  endpoint: string;
  value: string | null;
  label: string;
  id: string;
  hint?: string;
}

/** Campo "chat id do WhatsApp" com salvar inline. Vazio apaga. */
export function ChatIdField({ endpoint, value, label, id, hint }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const whatsappChatId = String(new FormData(e.currentTarget).get("whatsappChatId") ?? "").trim();
    setBusy(true);
    setStatus({});
    const res = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ whatsappChatId }) });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; details?: { fieldErrors?: Record<string, string[]> } };
      setStatus({ error: body.details?.fieldErrors?.whatsappChatId?.[0] ?? body.error ?? "Não foi possível salvar." });
      return;
    }
    setStatus({ ok: whatsappChatId ? "Salvo." : "Removido." });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="field">
      <label htmlFor={id}>{label}</label>
      <div className="row">
        <input id={id} name="whatsappChatId" type="text" defaultValue={value ?? ""} placeholder="120363424632069171@g.us" pattern="^\d{5,20}(-\d+)?@(g|c)\.us$|^$" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn small" type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar"}</button>
      </div>
      {hint && <small className="hint">{hint}</small>}
      {status.error && <small className="field-error" role="alert"><IconAlert size="sm" />{status.error}</small>}
      {status.ok && <small className="hint" role="status" style={{ color: "var(--ok)" }}><IconCheck size="sm" /> {status.ok}</small>}
    </form>
  );
}
```

- [ ] **Step 5: Unidades e contas** — em `apps/web/src/app/(app)/unidades/page.tsx`: importe `ChatIdField`; carregue `const org = admin ? await prisma.organization.findUniqueOrThrow({ where: { id: s.organizationId }, select: { whatsappChatId: true } }) : null;`. Logo após `{admin ? <UnitForm /> : ...}` insira:

```tsx
      {admin && org && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Grupo WhatsApp da franqueadora</h2>
          <p className="muted">Destino "Franqueadora" dos Avisos WhatsApp. Formato WAHA: id do grupo (`...@g.us`) ou número (`55DDDN@c.us`).</p>
          <ChatIdField endpoint="/api/organization" value={org.whatsappChatId} label="Grupo da franqueadora" id="org-chat" />
        </section>
      )}
```

Dentro de cada `section.card` da unidade, logo após o `div.row.between` do cabeçalho:

```tsx
              {admin && <ChatIdField endpoint={`/api/units/${u.id}`} value={u.whatsappChatId} label="Grupo WhatsApp da unidade (Avisos)" id={`chat-${u.id}`} hint={u.whatsappChatId ? undefined : "Sem grupo, a unidade não recebe avisos."} />}
```

`listUnitsWithAccounts` já devolve a `Unit` inteira (`findMany` + `include`), então `u.whatsappChatId` existe após `pnpm --filter @fsp/db build`.

- [ ] **Step 6: Minha conta** — em `apps/web/src/app/(app)/conta/page.tsx`, carregue `const me = await prisma.user.findUniqueOrThrow({ where: { id: s.userId }, select: { whatsappChatId: true } });` e acrescente uma terceira seção no `grid cols-2`:

```tsx
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Meu WhatsApp</h2>
          <p className="muted">Usado pelo botão "Enviar teste para mim" dos Avisos WhatsApp. Alguns números só funcionam no formato antigo de 12 dígitos (sem o nono dígito).</p>
          <ChatIdField endpoint="/api/account/whatsapp" value={me.whatsappChatId} label="Número (formato WAHA)" id="me-chat" hint="Ex.: 554899073477@c.us" />
        </section>
```

- [ ] **Step 7: Verificar** — `pnpm --filter @fsp/web typecheck`; `pnpm dev`; em `/unidades` (como `dono@rede.local`) salvar `120363424632069171@g.us` numa unidade e no grupo da franqueadora → "Salvo."; valor inválido → mensagem de formato; em `/conta` salvar o próprio número. Como `gestor@rede.local`: `curl -X PATCH` em `/api/units/<id>` → 403; `/api/account/whatsapp` → 200.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/api/units/[id]/route.ts" apps/web/src/app/api/organization/route.ts apps/web/src/app/api/account/whatsapp/route.ts apps/web/src/components/ChatIdField.tsx "apps/web/src/app/(app)/unidades/page.tsx" "apps/web/src/app/(app)/conta/page.tsx"
git commit -m "feat(web): chat id do WhatsApp por unidade, da franqueadora e do usuário (Unidades e contas / Minha conta)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 13: Rotas `/api/whatsapp-notices/*` (todas `requireAdmin`)

**Files:** Create `apps/web/src/app/api/whatsapp-notices/route.ts`, `[id]/route.ts`, `[id]/state/route.ts`, `test/route.ts`; Modify `apps/web/src/lib/queue.ts` (nada) — reutiliza `getQueue()`

- [ ] **Step 1: `route.ts`** — `apps/web/src/app/api/whatsapp-notices/route.ts`:

```ts
import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getQueue } from "@/lib/queue";
import { createNotice, listDeliveries, listNotices } from "@/lib/services/whatsapp-notices";
import { requireSession } from "@/lib/session";

export const GET = route(async () => {
  const s = await requireSession();
  requireAdmin(s);
  const [notices, deliveries] = await Promise.all([listNotices(prisma, s.organizationId), listDeliveries(prisma, s.organizationId)]);
  return NextResponse.json({ notices, deliveries });
});

export const POST = route(async (req: Request) => {
  const s = await requireSession();
  requireAdmin(s);
  const notice = await createNotice({ prisma, queue: getQueue() }, s.organizationId, s.userId, await req.json());
  return NextResponse.json({ notice }, { status: 201 });
});
```

- [ ] **Step 2: `[id]/route.ts`** (editar):

```ts
import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getQueue } from "@/lib/queue";
import { updateNotice } from "@/lib/services/whatsapp-notices";
import { requireSession } from "@/lib/session";

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireSession();
  requireAdmin(s);
  const { id } = await ctx.params;
  const notice = await updateNotice({ prisma, queue: getQueue() }, s.organizationId, id, await req.json());
  return NextResponse.json({ notice });
});
```

- [ ] **Step 3: `[id]/state/route.ts`** (pausar/retomar/cancelar):

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getQueue } from "@/lib/queue";
import { changeNoticeState } from "@/lib/services/whatsapp-notices";
import { requireSession } from "@/lib/session";

const schema = z.object({ state: z.enum(["ativo", "pausado", "cancelado"]) });

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireSession();
  requireAdmin(s);
  const { id } = await ctx.params;
  const { state } = schema.parse(await req.json());
  await changeNoticeState({ prisma, queue: getQueue() }, s.organizationId, id, state);
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 4: `test/route.ts`** ("Enviar teste para mim"):

```ts
import { WahaClient } from "@fsp/connectors";
import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { sendTestNotice } from "@/lib/services/whatsapp-notices";
import { requireSession } from "@/lib/session";

export const POST = route(async (req: Request) => {
  const s = await requireSession();
  requireAdmin(s);
  await sendTestNotice(prisma, WahaClient.fromEnv(), s.userId, await req.json());
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 5: Verificar** — `pnpm --filter @fsp/web typecheck`. Com `pnpm dev` e o cookie de `gestor@rede.local`: `GET /api/whatsapp-notices` → `403 {"error":"Apenas administradores podem fazer isso."}`. Como `dono@rede.local`: `POST /api/whatsapp-notices` com `{"text":"oi","targets":{"unidades":[],"todas":true,"franqueadora":false},"firstSendLocal":"2030-01-01T10:00","recurrence":{"tipo":"nenhuma"}}` → 201 e um job `whatsapp-notice-<id>-<ms>-0` no Redis (`redis-cli KEYS "bull:publish:whatsapp-notice-*"`); `POST .../state {"state":"cancelado"}` → 200 e o job some.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/whatsapp-notices
git commit -m "feat(web): API dos Avisos WhatsApp (listar, agendar, editar, estado, teste) restrita a administradores

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 14: Página `/avisos`, componentes e menu

**Files:** Create `apps/web/src/app/(app)/avisos/page.tsx`, `apps/web/src/components/NoticeComposer.tsx`, `NoticeList.tsx`, `NoticeHistory.tsx`; Modify `apps/web/src/components/Icons.tsx`, `apps/web/src/components/AppSidebar.tsx`, `apps/web/src/lib/format.ts`

- [ ] **Step 1: Ícone e menu** — em `Icons.tsx`, após `IconMegaphone`:

```tsx
export const IconWhatsapp = (p: P) => <I {...p}><path d="M21 12a9 9 0 0 1-13.3 7.9L3 21l1.1-4.6A9 9 0 1 1 21 12z" /><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1.2-1.4-1.9-.9-.9.9a4 4 0 0 1-2.5-2.5l.9-.9-.9-1.9z" /></I>;
```

Em `AppSidebar.tsx`, importe `IconWhatsapp` e troque o spread condicional por:

```tsx
    ...(isAdmin ? [{ label: "Usuários", href: "/usuarios", icon: <IconUsers /> }, { label: "Avisos WhatsApp", href: "/avisos", icon: <IconWhatsapp /> }] : []),
```

- [ ] **Step 2: Rótulos** — em `apps/web/src/lib/format.ts` acrescente:

```ts
/** Estados dos Avisos WhatsApp -> rótulo e classe de `.badge` reaproveitada. */
export const NOTICE_STATE_LABELS: Record<string, { label: string; badge: string }> = {
  ativo: { label: "Ativo", badge: "SCHEDULED" },
  pausado: { label: "Pausado", badge: "FAILED" },
  enviando: { label: "Enviando", badge: "PUBLISHING" },
  concluido: { label: "Concluído", badge: "PUBLISHED" },
  cancelado: { label: "Cancelado", badge: "CANCELLED" },
};
export const DELIVERY_STATUS_LABELS: Record<string, { label: string; badge: string }> = {
  enviado: { label: "Enviado", badge: "PUBLISHED" },
  falhou: { label: "Falhou", badge: "FAILED" },
  perdido: { label: "Perdido", badge: "CANCELLED" },
  pausado: { label: "Pausado", badge: "PUBLISHING" },
};
export const RECURRENCE_LABELS: Record<string, string> = { nenhuma: "Única", diaria: "Diária", semanal: "Semanal", mensal: "Mensal" };
export const WEEKDAYS_PT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export function describeRecurrence(rec: { tipo: string; dias?: number[]; dia?: number | string }): string {
  if (rec.tipo === "semanal") return `Semanal (${(rec.dias ?? []).map((d) => WEEKDAYS_PT[d]).join(", ")})`;
  if (rec.tipo === "mensal") return `Mensal (dia ${rec.dia === "ultimo" ? "último" : rec.dia})`;
  return RECURRENCE_LABELS[rec.tipo] ?? rec.tipo;
}
```

- [ ] **Step 3: Página** — `apps/web/src/app/(app)/avisos/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { IconAlert } from "@/components/Icons";
import { NoticeComposer } from "@/components/NoticeComposer";
import { NoticeHistory } from "@/components/NoticeHistory";
import { NoticeList } from "@/components/NoticeList";
import { isAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { noticePageData } from "@/lib/services/whatsapp-notices";
import { requireSession } from "@/lib/session";

export default async function NoticesPage({ searchParams }: { searchParams: Promise<{ editar?: string }> }) {
  const s = await requireSession();
  if (!isAdmin(s)) redirect("/");
  const sp = await searchParams;
  const data = await noticePageData(prisma, s.organizationId, s.userId);
  const wahaOn = Boolean(process.env.WAHA_URL);
  const aiOn = Boolean(process.env.ANTHROPIC_API_KEY);
  const withoutChat = data.units.filter((u) => !u.whatsappChatId);
  const editing = sp.editar ? data.notices.find((n) => n.id === sp.editar) ?? null : null;

  return (
    <div className="stack lg">
      <div className="page-head">
        <div>
          <h1>Avisos WhatsApp</h1>
          <p className="lead">Escreva um aviso, escolha as unidades e o horário. O envio é feito pelo sistema no horário de Brasília, com histórico por destino.</p>
        </div>
      </div>
      {!wahaOn && <div className="alert warn" role="alert"><IconAlert size="sm" /><span>Envio desabilitado: configure WAHA_URL (e WAHA_API_KEY) no servidor.</span></div>}
      {!data.franchisorChatId && <div className="alert info"><IconAlert size="sm" /><span>O grupo da franqueadora não está cadastrado. <Link href="/unidades">Cadastrar em Unidades e contas</Link>.</span></div>}
      {withoutChat.length > 0 && <div className="alert info"><IconAlert size="sm" /><span>{withoutChat.length} unidade(s) sem grupo WhatsApp não recebem avisos: {withoutChat.map((u) => u.name).join(", ")}. <Link href="/unidades">Cadastrar grupos</Link>.</span></div>}
      {!data.myChatId && <div className="alert info"><IconAlert size="sm" /><span>Para usar "Enviar teste para mim", cadastre seu número em <Link href="/conta">Minha conta</Link>.</span></div>}

      <NoticeComposer
        key={editing?.id ?? "new"}
        units={data.units}
        hasFranchisor={Boolean(data.franchisorChatId)}
        canTest={wahaOn && Boolean(data.myChatId)}
        aiAvailable={aiOn}
        editing={editing ? { id: editing.id, text: editing.text, targets: editing.targets as never, firstSendAt: editing.firstSendAt.toISOString(), recurrence: editing.recurrence as never, endAt: editing.endAt?.toISOString() ?? null } : null}
      />
      <NoticeList notices={data.notices.map((n) => ({ id: n.id, text: n.text, targets: n.targets as never, recurrence: n.recurrence as never, nextRunAt: n.nextRunAt?.toISOString() ?? null, state: n.state }))} unitNames={Object.fromEntries(data.units.map((u) => [u.id, u.name]))} />
      <NoticeHistory rows={data.deliveries.map((d) => ({ id: d.id, sentAt: d.sentAt.toISOString(), targetName: d.targetName, status: d.status, text: d.notice.text, error: d.error }))} />
    </div>
  );
}
```

- [ ] **Step 4: `NoticeList.tsx`**:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NoticeRecurrence, NoticeTargets } from "@fsp/core";
import { IconX } from "./Icons";
import { NOTICE_STATE_LABELS, describeRecurrence, formatInTz, shorten } from "@/lib/format";

export interface NoticeRow { id: string; text: string; targets: NoticeTargets; recurrence: NoticeRecurrence; nextRunAt: string | null; state: string }

export function NoticeList({ notices, unitNames }: { notices: NoticeRow[]; unitNames: Record<string, string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setState(id: string, state: "ativo" | "pausado" | "cancelado") {
    if (state === "cancelado" && !confirm("Cancelar este aviso?")) return;
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/whatsapp-notices/${id}/state`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
    setBusy(null);
    if (!res.ok) { const b = (await res.json().catch(() => ({}))) as { error?: string }; setError(b.error ?? "Erro"); return; }
    router.refresh();
  }

  const describeTargets = (t: NoticeTargets) => `${t.todas ? "todas as unidades" : `${t.unidades.length} unid. (${t.unidades.map((id) => unitNames[id] ?? "?").join(", ")})`}${t.franqueadora ? " + franqueadora" : ""}`;

  return (
    <section className="card stack" aria-labelledby="proximos">
      <h2 id="proximos" style={{ margin: 0 }}>Próximos envios</h2>
      {error && <div className="alert error" role="alert">{error}</div>}
      {notices.length === 0 ? (
        <div className="empty"><strong>Nenhum aviso agendado</strong><span>Use o formulário acima para agendar o primeiro.</span></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Próximo</th><th>Texto</th><th>Destinos</th><th>Repetição</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {notices.map((n) => {
                const st = NOTICE_STATE_LABELS[n.state] ?? { label: n.state, badge: "" };
                return (
                  <tr key={n.id}>
                    <td>{n.nextRunAt ? formatInTz(new Date(n.nextRunAt), "America/Sao_Paulo") : "—"}</td>
                    <td title={n.text}>{shorten(n.text)}</td>
                    <td>{describeTargets(n.targets)}</td>
                    <td>{describeRecurrence(n.recurrence)}</td>
                    <td><span className={`badge ${st.badge}`}>{st.label}</span></td>
                    <td className="actions">
                      {n.state === "enviando" ? <em>enviando…</em> : (
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                          {n.state === "ativo" && <button className="btn small" disabled={busy === n.id} onClick={() => setState(n.id, "pausado")}>Pausar</button>}
                          {n.state === "pausado" && <button className="btn small" disabled={busy === n.id} onClick={() => setState(n.id, "ativo")}>Retomar</button>}
                          <Link className="btn small" href={`/avisos?editar=${n.id}`}>Editar</Link>
                          <button className="btn small danger" disabled={busy === n.id} onClick={() => setState(n.id, "cancelado")}><IconX size="sm" /> Cancelar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: `NoticeHistory.tsx`**:

```tsx
import { DELIVERY_STATUS_LABELS, formatInTz, shorten } from "@/lib/format";

export interface DeliveryRow { id: string; sentAt: string; targetName: string; status: string; text: string; error: string | null }

export function NoticeHistory({ rows }: { rows: DeliveryRow[] }) {
  return (
    <section className="card stack" aria-labelledby="historico">
      <h2 id="historico" style={{ margin: 0 }}>Histórico (últimos 200 envios)</h2>
      {rows.length === 0 ? <div className="empty"><strong>Nenhum envio ainda</strong></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Quando</th><th>Destino</th><th>Status</th><th>Texto</th><th>Erro</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const st = DELIVERY_STATUS_LABELS[r.status] ?? { label: r.status, badge: "" };
                return (
                  <tr key={r.id}>
                    <td>{formatInTz(new Date(r.sentAt), "America/Sao_Paulo")}</td>
                    <td>{r.targetName}</td>
                    <td><span className={`badge ${st.badge}`}>{st.label}</span></td>
                    <td title={r.text}>{shorten(r.text)}</td>
                    <td><small>{r.error ?? ""}</small></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 6: `NoticeComposer.tsx`** (o botão "Gerar com IA" chama `/api/whatsapp-notices/generate`, criado na Task 15; até lá responde 404 e a tela mostra o erro):

```tsx
"use client";

// Componente client: NUNCA importar a raiz "@fsp/core" (puxa node:crypto). Só subpaths e `import type`.
import { utcToLocal } from "@fsp/core/timezone";
import { NOTICE_TEXT_MAX } from "@fsp/core/whatsapp-notices";
import type { NoticeRecurrence, NoticeTargets } from "@fsp/core";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { IconAlert, IconCheck } from "./Icons";
import { WEEKDAYS_PT } from "@/lib/format";

const TZ = "America/Sao_Paulo";
const TONES = ["Amigável", "Formal", "Urgente"];

export interface ComposerUnit { id: string; name: string; whatsappChatId: string | null }
export interface EditingNotice { id: string; text: string; targets: NoticeTargets; firstSendAt: string; recurrence: NoticeRecurrence; endAt: string | null }

function minLocal(): string {
  return utcToLocal(new Date(Date.now() + 5 * 60_000), TZ);
}

const HTML_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

/** Prévia com a formatação do WhatsApp: escapa HTML antes de aplicar *negrito* e _itálico_. */
function previewHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => HTML_ESCAPE[c] ?? c).replace(/\*(.+?)\*/g, "<b>$1</b>").replace(/_(.+?)_/g, "<i>$1</i>").replace(/\n/g, "<br>");
}

export function NoticeComposer({ units, hasFranchisor, canTest, aiAvailable, editing }: { units: ComposerUnit[]; hasFranchisor: boolean; canTest: boolean; aiAvailable: boolean; editing: EditingNotice | null }) {
  const router = useRouter();
  const [text, setText] = useState(editing?.text ?? "");
  const [unidades, setUnidades] = useState<Set<string>>(new Set(editing?.targets.unidades ?? []));
  const [todas, setTodas] = useState(editing?.targets.todas ?? false);
  const [franqueadora, setFranqueadora] = useState(editing?.targets.franqueadora ?? false);
  const [when, setWhen] = useState(editing ? utcToLocal(new Date(editing.firstSendAt), TZ) : "");
  const [tipo, setTipo] = useState<NoticeRecurrence["tipo"]>(editing?.recurrence.tipo ?? "nenhuma");
  const [dias, setDias] = useState<Set<number>>(new Set(editing?.recurrence.tipo === "semanal" ? editing.recurrence.dias : []));
  const [diaMes, setDiaMes] = useState(editing?.recurrence.tipo === "mensal" ? String(editing.recurrence.dia) : "1");
  const [endDate, setEndDate] = useState(editing?.endAt ? utcToLocal(new Date(editing.endAt), TZ).slice(0, 10) : "");
  const [assunto, setAssunto] = useState("");
  const [tom, setTom] = useState(TONES[0]);
  const [busy, setBusy] = useState<"save" | "test" | "ai" | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  const available = useMemo(() => units.filter((u) => u.whatsappChatId), [units]);
  const count = todas ? available.length : [...unidades].filter((id) => available.some((u) => u.id === id)).length;
  const blocker =
    text.trim() === "" ? "Escreva o texto."
    : count === 0 && !franqueadora ? "Escolha ao menos um destino."
    : !when ? "Escolha data e hora."
    : tipo === "semanal" && dias.size === 0 ? "Marque ao menos um dia da semana."
    : null;

  function body() {
    const recurrence: NoticeRecurrence =
      tipo === "semanal" ? { tipo, dias: [...dias].sort() }
      : tipo === "mensal" ? { tipo, dia: diaMes.trim().toLowerCase() === "ultimo" ? "ultimo" : Number(diaMes) }
      : { tipo };
    return { text, targets: { unidades: todas ? [] : [...unidades], todas, franqueadora }, firstSendLocal: when, recurrence, endDate: endDate || null };
  }

  async function call(kind: "save" | "test" | "ai") {
    setBusy(kind);
    setMsg({});
    const [url, method, payload] =
      kind === "save" ? [editing ? `/api/whatsapp-notices/${editing.id}` : "/api/whatsapp-notices", editing ? "PATCH" : "POST", body()]
      : kind === "test" ? ["/api/whatsapp-notices/test", "POST", { text }]
      : ["/api/whatsapp-notices/generate", "POST", { assunto, tom }];
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = (await res.json().catch(() => ({}))) as { error?: string; text?: string };
    setBusy(null);
    if (!res.ok) { setMsg({ error: data.error ?? "Erro" }); return; }
    if (kind === "ai") { setText(data.text ?? ""); setMsg({ ok: "Texto gerado. Revise antes de agendar." }); return; }
    if (kind === "test") { setMsg({ ok: "Teste enviado para o seu número." }); return; }
    setMsg({ ok: editing ? "Aviso atualizado." : "Aviso agendado." });
    if (editing) router.push("/avisos");
    else { setText(""); setAssunto(""); }
    router.refresh();
  }

  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); return n; };

  return (
    <div className="grid composer">
      <div className="card stack lg">
        {editing && <div className="alert info"><IconAlert size="sm" /><span>Editando um aviso existente. <a href="/avisos">Cancelar edição</a></span></div>}
        <section className="section">
          <h2 className="section-title"><span className="num">1</span> Texto</h2>
          <div className="field">
            <label htmlFor="notice-text">Mensagem (formatação do WhatsApp: *negrito*, _itálico_)</label>
            <textarea id="notice-text" value={text} maxLength={NOTICE_TEXT_MAX} onChange={(e) => setText(e.target.value)} rows={6} />
            <small className="hint">{[...text].length}/{NOTICE_TEXT_MAX}</small>
          </div>
          {text && <div className="card tight" aria-label="Prévia" dangerouslySetInnerHTML={{ __html: previewHtml(text) }} />}
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="muted">Gerar com IA</legend>
            <div className="row">
              <input type="text" value={assunto} onChange={(e) => setAssunto(e.target.value)} placeholder="Assunto (ex.: lembrete de fechamento de caixa toda sexta)" style={{ flex: 1, minWidth: 240 }} aria-label="Assunto" />
              <select value={tom} onChange={(e) => setTom(e.target.value)} aria-label="Tom">{TONES.map((t) => <option key={t}>{t}</option>)}</select>
              <button type="button" className="btn" disabled={!aiAvailable || busy !== null || assunto.trim() === ""} title={aiAvailable ? undefined : "Configure ANTHROPIC_API_KEY no servidor"} onClick={() => call("ai")}>{busy === "ai" ? <span className="spinner" aria-hidden="true" /> : null} Gerar com IA</button>
            </div>
          </fieldset>
        </section>

        <section className="section">
          <h2 className="section-title"><span className="num">2</span> Destinos</h2>
          <div className="row">
            <label className={`chip ${todas ? "on" : ""}`}><input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} /> Todas as unidades ({available.length})</label>
            <label className={`chip ${franqueadora ? "on" : ""}`} title={hasFranchisor ? undefined : "Cadastre o grupo da franqueadora em Unidades e contas"}><input type="checkbox" checked={franqueadora} disabled={!hasFranchisor} onChange={(e) => setFranqueadora(e.target.checked)} /> Franqueadora</label>
          </div>
          {!todas && (
            <div className="row">
              {units.map((u) => (
                <label key={u.id} className={`chip ${unidades.has(u.id) ? "on" : ""}`} title={u.whatsappChatId ? u.whatsappChatId : "Sem grupo WhatsApp cadastrado"}>
                  <input type="checkbox" checked={unidades.has(u.id)} disabled={!u.whatsappChatId} onChange={() => setUnidades((s) => toggle(s, u.id))} /> {u.name}
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="section">
          <h2 className="section-title"><span className="num">3</span> Quando</h2>
          <div className="grid cols-3">
            <div className="field"><label htmlFor="notice-when">Primeiro envio (horário de Brasília)</label><input id="notice-when" type="datetime-local" value={when} min={minLocal()} onChange={(e) => setWhen(e.target.value)} required /></div>
            <div className="field"><label htmlFor="notice-rec">Repetição</label>
              <select id="notice-rec" value={tipo} onChange={(e) => setTipo(e.target.value as NoticeRecurrence["tipo"])}>
                <option value="nenhuma">Nenhuma</option><option value="diaria">Diária</option><option value="semanal">Semanal</option><option value="mensal">Mensal</option>
              </select>
            </div>
            <div className="field"><label htmlFor="notice-end">Até (opcional)</label><input id="notice-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
          </div>
          {tipo === "semanal" && (
            <div className="row">{WEEKDAYS_PT.map((n, i) => <label key={i} className={`chip ${dias.has(i) ? "on" : ""}`}><input type="checkbox" checked={dias.has(i)} onChange={() => setDias((s) => { const d = new Set(s); d.has(i) ? d.delete(i) : d.add(i); return d; })} /> {n}</label>)}</div>
          )}
          {tipo === "mensal" && (
            <div className="field" style={{ maxWidth: 240 }}><label htmlFor="notice-dia">Dia do mês (1–31 ou "ultimo")</label><input id="notice-dia" type="text" value={diaMes} onChange={(e) => setDiaMes(e.target.value)} /></div>
          )}
        </section>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Resumo</h2>
        <p className="muted">
          {count > 0 || franqueadora ? `${todas ? "Todas as unidades" : `${count} unidade(s)`}${franqueadora ? " + franqueadora" : ""}` : "Nenhum destino"} · {tipo === "nenhuma" ? "envio único" : `repetição ${tipo}`}{endDate ? ` até ${endDate.split("-").reverse().join("/")}` : ""}
        </p>
        {msg.error && <div className="alert error" role="alert"><IconAlert size="sm" /><span>{msg.error}</span></div>}
        {msg.ok && <div className="alert ok" role="status"><IconCheck size="sm" /><span>{msg.ok}</span></div>}
        <div className="action-bar">
          <button className="btn primary" type="button" disabled={busy !== null || blocker !== null} onClick={() => call("save")}>{busy === "save" ? <span className="spinner" aria-hidden="true" /> : null} {editing ? "Salvar alterações" : "Agendar aviso"}</button>
          <button className="btn" type="button" disabled={busy !== null || !canTest || text.trim() === ""} title={canTest ? undefined : "Cadastre seu número em Minha conta (e WAHA_URL no servidor)"} onClick={() => call("test")}>{busy === "test" ? <span className="spinner" aria-hidden="true" /> : null} Enviar teste para mim</button>
          {blocker && <small className="why">{blocker}</small>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Verificar** — `pnpm --filter @fsp/web typecheck`; `pnpm dev`. Como `dono@rede.local`: o menu mostra "Avisos WhatsApp"; `/avisos` renderiza com os alertas; agendar para +3 min com "Todas as unidades" → aparece em Próximos envios como Ativo; Pausar/Retomar/Editar/Cancelar funcionam; com o worker rodando (`pnpm dev` sobe os dois) e `WAHA_URL` ausente, após o horário o histórico mostra `falhou` ("WAHA_URL não configurada") e, no 3º minuto, `pausado` com a linha de sistema. Como `gestor@rede.local`: sem link no menu; `/avisos` redireciona para `/`.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/(app)/avisos/page.tsx" apps/web/src/components/NoticeComposer.tsx apps/web/src/components/NoticeList.tsx apps/web/src/components/NoticeHistory.tsx apps/web/src/components/Icons.tsx apps/web/src/components/AppSidebar.tsx apps/web/src/lib/format.ts
git commit -m "feat(web): página /avisos (compor, destinos, recorrência, lista e histórico) e menu Avisos WhatsApp só para administradores

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Chunk 4: IA, variáveis/deploy e verificação de ponta a ponta

### Task 15: "Gerar com IA" — serviço + rota `/api/whatsapp-notices/generate`

**Files:** Create `apps/web/src/lib/prompts/aviso-whatsapp.ts`, `apps/web/src/lib/services/whatsapp-ai.ts`, `apps/web/src/lib/services/whatsapp-ai.test.ts`, `apps/web/src/app/api/whatsapp-notices/generate/route.ts`; Modify `apps/web/package.json`

- [ ] **Step 1: Dependência** — Run: `pnpm --filter @fsp/web add @anthropic-ai/sdk`
Expected: `@anthropic-ai/sdk` em `dependencies` de `apps/web/package.json` e `pnpm-lock.yaml` atualizado.

- [ ] **Step 2: Teste** — `apps/web/src/lib/services/whatsapp-ai.test.ts` (cliente substituído por um fake, como `tests/test_ia.py` do daily):

```ts
import { describe, expect, it } from "vitest";
import { generateNoticeText, type NoticeAiClient } from "./whatsapp-ai";

function fakeClient(resp: { stop_reason: string | null; content: Array<{ type: string; text?: string }> }, seen: Record<string, unknown>[] = []): NoticeAiClient {
  return { async create(params, options) { seen.push({ ...params, options }); return resp; } };
}

describe("generateNoticeText", () => {
  it("sem chave -> 503", async () => {
    await expect(generateNoticeText({ apiKey: undefined, client: fakeClient({ stop_reason: "end_turn", content: [] }) }, { assunto: "x", tom: "Formal" })).rejects.toMatchObject({ status: 503 });
  });
  it("chama a API com os parâmetros do daily e devolve o texto trimado", async () => {
    const seen: Record<string, unknown>[] = [];
    const text = await generateNoticeText({ apiKey: "k", client: fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "  Olá *time*! Lembrete.  " }] }, seen) }, { assunto: "lembrete de caixa", tom: "Formal" });
    expect(text).toBe("Olá *time*! Lembrete.");
    expect(seen[0]).toMatchObject({ model: "claude-opus-5-5", max_tokens: 1024, output_config: { effort: "low" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", options: { timeout: 30_000, maxRetries: 1 } });
    expect((seen[0]?.messages as Array<{ content: string }>)[0]?.content).toBe("Assunto: lembrete de caixa\nTom: Formal");
    expect(String(seen[0]?.system)).toContain("Barbearia VIP");
  });
  it("recusa vira erro amigável; assunto vazio e tom desconhecido", async () => {
    await expect(generateNoticeText({ apiKey: "k", client: fakeClient({ stop_reason: "refusal", content: [] }) }, { assunto: "x", tom: "Amigável" })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("não conseguiu") });
    await expect(generateNoticeText({ apiKey: "k", client: fakeClient({ stop_reason: "end_turn", content: [] }) }, { assunto: "  ", tom: "Amigável" })).rejects.toMatchObject({ status: 400, message: "Informe o assunto." });
    const seen: Record<string, unknown>[] = [];
    await generateNoticeText({ apiKey: "k", client: fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }, seen) }, { assunto: "x", tom: "Sarcástico" });
    expect((seen[0]?.messages as Array<{ content: string }>)[0]?.content).toContain("Tom: Amigável");
  });
});
```

- [ ] **Step 3: Rodar — deve falhar** — `pnpm --filter @fsp/web test -- whatsapp-ai`.

- [ ] **Step 4: Prompt** — `apps/web/src/lib/prompts/aviso-whatsapp.ts` (texto idêntico a `daily/admin/prompts/mensagem_sistema.txt`):

```ts
/** System prompt do "Gerar com IA" (mesmo texto de daily/admin/prompts/mensagem_sistema.txt). */
export const AVISO_WHATSAPP_SYSTEM_PROMPT = `Você escreve mensagens curtas de WhatsApp para a rede de franquias Barbearia VIP. O público são os franqueados e as equipes das unidades.
Regras:
- Português do Brasil, direto e cordial; o tom pedido (Amigável, Formal ou Urgente) define o registro.
- Formatação do WhatsApp: *negrito* para o ponto principal; emojis com moderação (no máximo 2).
- Curta: até cerca de 600 caracteres, em 1 a 3 parágrafos.
- Nunca invente datas, valores, nomes de pessoas ou unidades que não estejam no assunto. Se faltar um dado essencial, deixe um marcador entre colchetes, ex.: [data].
- Responda SOMENTE com o texto da mensagem, sem título, sem explicações, sem aspas.`;
```

- [ ] **Step 5: Serviço** — `apps/web/src/lib/services/whatsapp-ai.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { HttpError } from "../api";
import { AVISO_WHATSAPP_SYSTEM_PROMPT } from "../prompts/aviso-whatsapp";

export const AI_MODEL = "claude-opus-5-5";
export const TONES = ["Amigável", "Formal", "Urgente"] as const;

/** Resposta mínima que o serviço lê (subconjunto de `BetaMessage`). */
export interface NoticeAiResponse {
  stop_reason: string | null;
  content: Array<{ type: string; text?: string }>;
}

/** Cliente injetável: em produção adapta `client.beta.messages.create`; nos testes, um fake. */
export interface NoticeAiClient {
  create(params: Record<string, unknown>, options: { timeout: number; maxRetries: number }): Promise<NoticeAiResponse>;
}

export function anthropicNoticeClient(apiKey: string): NoticeAiClient {
  const client = new Anthropic({ apiKey });
  return {
    // `fallbacks: "default"` pode ainda não constar nos tipos do SDK; o cast evita quebrar o typecheck.
    create: (params, options) => client.beta.messages.create(params as never, options) as unknown as Promise<NoticeAiResponse>,
  };
}

const inputSchema = z.object({ assunto: z.string().max(500).default(""), tom: z.string().max(40).default(TONES[0]) });

/**
 * Gera o texto do aviso (porta de daily/admin/ia.py): claude-opus-5-5, effort low, 1024 tokens,
 * fallback de recusa do lado do servidor, timeout 30 s. O texto NUNCA é agendado automaticamente.
 */
export async function generateNoticeText(deps: { apiKey: string | undefined; client?: NoticeAiClient }, raw: unknown): Promise<string> {
  if (!deps.apiKey) throw new HttpError(503, "IA não configurada (ANTHROPIC_API_KEY).");
  const input = inputSchema.parse(raw);
  const assunto = input.assunto.trim();
  if (!assunto) throw new HttpError(400, "Informe o assunto.");
  const tom = (TONES as readonly string[]).includes(input.tom) ? input.tom : TONES[0];
  const client = deps.client ?? anthropicNoticeClient(deps.apiKey);
  let resp: NoticeAiResponse;
  try {
    resp = await client.create(
      {
        model: AI_MODEL,
        max_tokens: 1024,
        output_config: { effort: "low" },
        system: AVISO_WHATSAPP_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Assunto: ${assunto}\nTom: ${tom}` }],
        // Recusa do classificador de segurança -> a API refaz a chamada noutro modelo
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { timeout: 30_000, maxRetries: 1 },
    );
  } catch (err) {
    // cadeia específica -> genérica, como no Python
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(400, "Chave da Anthropic inválida. Confira ANTHROPIC_API_KEY.");
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, "Limite de uso da IA atingido. Tente de novo em instantes.");
    if (err instanceof Anthropic.APIConnectionTimeoutError || err instanceof Anthropic.APIConnectionError) throw new HttpError(504, "Sem resposta da IA (tempo esgotado). Tente de novo.");
    if (err instanceof Anthropic.APIError) {
      console.error("[ia] Anthropic status", err.status, err.message);
      if ((err.status ?? 500) >= 500) throw new HttpError(503, "Serviço de IA indisponível no momento.");
      throw new HttpError(400, `Erro da IA: ${err.message}`);
    }
    throw err;
  }
  if (resp.stop_reason === "refusal") throw new HttpError(400, "A IA não conseguiu gerar uma mensagem para esse assunto. Reformule o pedido.");
  const text = resp.content.find((b) => b.type === "text")?.text?.trim() ?? "";
  if (!text) throw new HttpError(400, "A IA retornou vazio. Tente de novo.");
  return text;
}
```

- [ ] **Step 6: Rota** — `apps/web/src/app/api/whatsapp-notices/generate/route.ts`:

```ts
import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { optionalEnv } from "@/lib/env";
import { generateNoticeText } from "@/lib/services/whatsapp-ai";
import { requireSession } from "@/lib/session";

export const POST = route(async (req: Request) => {
  const s = await requireSession();
  requireAdmin(s);
  const text = await generateNoticeText({ apiKey: optionalEnv("ANTHROPIC_API_KEY") }, await req.json());
  return NextResponse.json({ text });
});
```

- [ ] **Step 7: Rodar — deve passar** — `pnpm --filter @fsp/web test -- whatsapp-ai` → `3 passed`; `pnpm --filter @fsp/web typecheck` limpo. Se o `typecheck` apontar que `APIConnectionTimeoutError` não existe na versão instalada do SDK, remova só essa classe da condição (`APIConnectionError` cobre o timeout).

- [ ] **Step 8: Teste real único (opcional, < US$ 0,01)** — com `ANTHROPIC_API_KEY` no `.env`, `pnpm dev` e, em `/avisos`, assunto "lembrete de fechamento de caixa toda sexta", tom Amigável → o texto aparece na caixa, editável; nada é agendado.

- [ ] **Step 9: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/prompts/aviso-whatsapp.ts apps/web/src/lib/services/whatsapp-ai.ts apps/web/src/lib/services/whatsapp-ai.test.ts apps/web/src/app/api/whatsapp-notices/generate/route.ts
git commit -m "feat(web): gerar aviso com IA (SDK Anthropic, claude-opus-5-5, fallback de recusa)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 16: Variáveis de ambiente, README e deploy

**Files:** Modify `.env.example`, `.env.production.example`, `README.md`

- [ ] **Step 1: `.env.example`** — ao final:

```
# Avisos WhatsApp (WAHA — WhatsApp HTTP API). Vazio desabilita o envio.
WAHA_URL=""
WAHA_API_KEY=""
WAHA_SESSION="default"
# Botão "Gerar com IA" na tela de Avisos (console.anthropic.com). Vazio desabilita o botão.
ANTHROPIC_API_KEY=""
```

- [ ] **Step 2: `.env.production.example`** — ao final (formato sem aspas, como o resto do arquivo):

```
# Avisos WhatsApp: mesma instância WAHA do briefing diário (daily). Vazio desabilita o envio.
WAHA_URL=
WAHA_API_KEY=
WAHA_SESSION=default
# Botão "Gerar com IA" na tela de Avisos. Vazio desabilita o botão.
ANTHROPIC_API_KEY=
```

- [ ] **Step 3: README** — nova seção após "## Perfis (gestão de perfil)":

````markdown
## Avisos WhatsApp

O menu **Avisos WhatsApp** (só administradores) agenda mensagens para os grupos de WhatsApp das
unidades via [WAHA](https://waha.devlike.pro/): texto livre ou gerado por IA a partir de um assunto,
destinos (unidades, todas, grupo da franqueadora), data/hora do primeiro envio no horário de
Brasília, repetição (única, diária, semanal, mensal com "ultimo") e data final. O worker envia no
horário (job `whatsapp-notice`), grava o resultado por destino no histórico e segue estas regras:
atraso acima de 2 h marca a ocorrência como "perdido" sem enviar; uma falha de ciclo é retentada no
minuto seguinte sem reenviar a quem já recebeu; três falhas consecutivas pausam o aviso (retomar
pela tela zera o contador). Avisos presos ou sem job na fila são recuperados pela reconciliação
(a cada 5 min e na subida do worker).

Configuração: `WAHA_URL`, `WAHA_API_KEY`, `WAHA_SESSION` (envio) e `ANTHROPIC_API_KEY` (botão
"Gerar com IA", modelo `claude-opus-5-5`). Os grupos ficam em **Unidades e contas** (campo "Grupo
WhatsApp" de cada unidade e o card "Grupo WhatsApp da franqueadora"); o número de cada usuário para
"Enviar teste para mim" fica em **Minha conta**. Formato WAHA: `123@g.us` (grupo) ou
`55DDDN@c.us` (número; alguns contatos só funcionam no JID antigo de 12 dígitos, sem o nono dígito).

Importar os grupos já usados pelo briefing diário (`daily/config/unit_groups.json`), casando pelo
nome da unidade sem acentos/caixa:

```bash
pnpm --filter @fsp/db import:whatsapp-groups -- /caminho/unit_groups.json   # --force sobrescreve
```
````

Na seção "## Usuários e permissões", no item **Administrador**, acrescente "e agenda Avisos WhatsApp"; na tabela do Stack, em `apps/worker`, acrescente "e envia os avisos de WhatsApp".

- [ ] **Step 4: Deploy (sem mudança de código nem de compose)** — a migration roda no serviço `migrate` do `docker-compose.prod.yml` como hoje. O WAHA de produção do `daily` é **externo, em HTTPS** (`WAHA_URL=https://waha.linkwise.digital`, sessão `ceovip`), então os containers `web` e `worker` o alcançam diretamente pela internet — nada de `extra_hosts`, IP de bridge ou rede especial. No servidor: acrescentar as 4 variáveis em `/opt/postagem/.env.production` com os mesmos valores do `.env` do `daily` (`WAHA_URL`, `WAHA_API_KEY`, `WAHA_SESSION=ceovip`) e rodar `bash deploy/deploy.sh feat/avisos-whatsapp` (ou `main` após o merge). Antes do primeiro agendamento, confira o alcance de dentro do worker (checklist da Task 17, item 2).

- [ ] **Step 5: Verificar** — `pnpm test` (toda a suíte) e `pnpm typecheck` verdes; `pnpm build` passa (o `next build` precisa resolver `@anthropic-ai/sdk`).

- [ ] **Step 6: Commit**

```bash
git add .env.example .env.production.example README.md
git commit -m "docs: variáveis WAHA_*/ANTHROPIC_API_KEY e seção Avisos WhatsApp no README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 17: E2E (Playwright, opcional) e checklist de verificação em produção

**Files:** Create `apps/web/e2e/avisos.spec.ts`

- [ ] **Step 1: Spec** (mesma infra de `permissoes.spec.ts`; Postgres + Redis locais):

```ts
import { expect, test } from "@playwright/test";
import { prisma, uniqueEmail } from "./helpers";

test("admin agenda um aviso e vê na lista; gestor não tem menu nem API", async ({ page, browser }) => {
  const adminEmail = uniqueEmail("admin");
  await page.goto("/registro");
  await page.fill("#organizationName", "Rede Avisos");
  await page.fill("#name", "Admin");
  await page.fill("#email", adminEmail);
  await page.fill("#password", "senha-forte-123");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
  const unit = await prisma.unit.create({ data: { organizationId: admin.organizationId, name: "Unidade Avisos", whatsappChatId: "120363000000000001@g.us" } });

  await page.goto("/avisos");
  await page.fill("#notice-text", "Lembrete: *fechamento de caixa* hoje.");
  await page.locator("label.chip", { hasText: "Unidade Avisos" }).click();
  const future = new Date(Date.now() + 2 * 86_400_000);
  await page.fill("#notice-when", `${future.toISOString().slice(0, 10)}T10:30`);
  await page.click("button:has-text('Agendar aviso')");
  await expect(page.locator(".alert.ok")).toContainText("Aviso agendado");
  await expect(page.locator("table").first()).toContainText("fechamento de caixa");
  const saved = await prisma.whatsappNotice.findFirstOrThrow({ where: { organizationId: admin.organizationId } });
  expect(saved.state).toBe("ativo");
  expect((saved.targets as { unidades: string[] }).unidades).toEqual([unit.id]);

  // gestor: sem link, página redireciona, API 403
  const managerEmail = uniqueEmail("gestor");
  await prisma.user.create({ data: { organizationId: admin.organizationId, email: managerEmail, name: "Gestor", role: "MANAGER", passwordHash: admin.passwordHash } });
  const ctx = await browser.newContext();
  const mp = await ctx.newPage();
  await mp.goto("/login");
  await mp.fill("#email", managerEmail);
  await mp.fill("#password", "senha-forte-123");
  await mp.click("button[type=submit]");
  await expect(mp.getByRole("heading", { name: "Painel" })).toBeVisible();
  await expect(mp.getByRole("link", { name: "Avisos WhatsApp" })).toHaveCount(0);
  await mp.goto("/avisos");
  await expect(mp).toHaveURL(/\/($|\?)/);
  expect((await mp.request.get("/api/whatsapp-notices")).status()).toBe(403);
  await ctx.close();
});
```

- [ ] **Step 2: Rodar** — `docker compose up -d && pnpm --filter @fsp/web test:e2e -- avisos` → `1 passed`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/avisos.spec.ts
git commit -m "test(e2e): agendar aviso como administrador; gestor sem menu e com 403

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: Checklist de produção (decisão do usuário: validar direto em produção, como no daily).** Tudo roda em `/opt/postagem` no servidor; `DC="docker compose --env-file .env.production -f docker-compose.prod.yml"`.
  1. `.env.production` com `WAHA_URL`, `WAHA_API_KEY`, `WAHA_SESSION` (os mesmos valores do `.env` do `daily` em `/opt/barbearia-daily/.env`; sessão de produção `ceovip`) e `ANTHROPIC_API_KEY`; `bash /opt/postagem/deploy/deploy.sh feat/avisos-whatsapp` (ou `main` após o merge) → `migrate` aplica `20261023233602_whatsapp_notices`; `web: HTTP 200 (ok)`; `worker: iniciado (ok)`; `$DC logs --since 5m worker` mostra `worker started` com `"noticeQueue":"whatsapp-notices","noticeConcurrency":1` e **sem** `waha disabled`.
  2. Alcance do WAHA de dentro do container do worker (antes do primeiro agendamento; a imagem é `node:22-alpine` sem `curl`, use o `fetch` do Node): `$DC exec worker node -e 'fetch(process.env.WAHA_URL.replace(/\/+$/,"")+"/api/sessions",{headers:{"X-Api-Key":process.env.WAHA_API_KEY}}).then(r=>console.log(r.status)).catch(e=>{console.error(e.message);process.exit(1)})'` → `200`. Qualquer outra coisa (401 = chave errada; erro de rede = URL/DNS/firewall) tem de ser resolvida antes de agendar.
  3. Importar os grupos do `daily` (`/opt/barbearia-daily/config/unit_groups.json`; ajuste se o clone estiver noutro caminho). O Postgres de produção não expõe porta no host, então o script roda **dentro da imagem do worker**, que já contém `packages/db/scripts`, o `tsx` (devDependency instalada antes de `NODE_ENV=production`) e o client Prisma gerado — comando verificado localmente contra a imagem construída com o mesmo Dockerfile:

     ```bash
     $DC run --rm --no-deps -v /opt/barbearia-daily/config/unit_groups.json:/tmp/unit_groups.json:ro \
       worker sh -c 'cd packages/db && node node_modules/tsx/dist/cli.mjs scripts/import-whatsapp-groups.ts /tmp/unit_groups.json'
     ```

     Com uma única organização no banco o script a escolhe sozinho (loga qual); com mais de uma, acrescente `--org <id>` (o erro lista os ids). Conferir as seções "NÃO casadas no daily" e "Unidades do Publicador sem correspondente" (nomes diferentes entre os sistemas; `(nome ambíguo)` = duas unidades com o mesmo nome normalizado) e os `AVISO:` de unidades com mais de um chat no `daily` (só o primeiro é importado); completar o que faltar em Unidades e contas. Rodar de novo é seguro: unidades já preenchidas aparecem em "Puladas" (só `--force` sobrescreve).
  4. **Operação em paralelo — atenção do operador:** o `/admin/mensagens` do `daily` (Python) **continua rodando** por decisão do usuário. Nunca cadastre o mesmo agendamento nos dois sistemas: a mensagem seria enviada duas vezes aos mesmos grupos. Até o desligamento do job `agendamentos` do `daily`, combine quem agenda o quê.
  5. Em Unidades e contas: card "Grupo WhatsApp da franqueadora" = `558597620180-1583264893@g.us` (**a confirmar** com a franqueadora antes de salvar — é o grupo que recebe o destino "Franqueadora"); em Minha conta: o próprio número (`554899073477@c.us`, JID antigo de 12 dígitos).
  6. `/avisos`: "Gerar com IA" produz texto na caixa (editável, nada é agendado); "Enviar teste para mim" chega no próprio número; agendar para +2 min **apenas para uma unidade de teste escolhida na hora** → histórico `enviado`; agendar um recorrente (semanal), pausar, retomar, editar o texto e **cancelar ao final** (some de "Próximos envios"; `$DC exec redis redis-cli --scan --pattern 'bull:whatsapp-notices:whatsapp-notice-*'` sem o job).
  7. Logs: `$DC logs --since 10m worker | grep -E '"msg":"(notice|reconcile notices|waha)'` mostra `notice sent` com `sent`/`failed` por ocorrência; `notice retry`/`notice paused` indicam falha no WAHA (o motivo fica em `WhatsappDelivery.error`, coluna "Erro" do histórico, ex.: `WAHA 401: ...`).
  8. O `daily` continua enviando os briefings normalmente; quando a franqueadora decidir migrar de vez, desligar lá o job `agendamentos` (fora deste plano).

---

## Follow-ups (fora do escopo deste plano)

- **Retentativa de publicações no worker existente**: `requeuePublish` é chamado enquanto o job ainda está `active` (`apps/worker/src/main.ts`, ramo `outcome === "retry"`); `dequeuePublish` não remove job ativo e o `add` com o mesmo `jobId` é ignorado pelo BullMQ (`addStandardJob` devolve o id existente quando `jobIdKey` já existe). Verificar em produção se a retentativa com backoff realmente acontece ou se depende da reconciliação de 5 min; se for o caso, aplicar o mesmo sufixo de tentativa no `publishJobId` que este plano usa nos avisos.
- Desligar o job `agendamentos` do `daily` e remover `admin/mensagens` de lá quando a franqueadora confirmar que só usa o Publicador.
- **Confirmar o grupo da franqueadora** (`558597620180-1583264893@g.us` é o candidato vindo do `daily`; marcado como "a confirmar" no checklist) e, se houver mais de um grupo da franqueadora, decidir se vira lista (`UnitWhatsappChat`/`OrganizationWhatsappChat`).
- O tipo da resposta do SDK Anthropic é adaptado por `NoticeAiClient` com `params as never`: quando `fallbacks`/`output_config.effort` estiverem estáveis nos tipos do `@anthropic-ai/sdk`, remover o cast e tipar `BetaMessageCreateParams` diretamente.
- Métrica/alerta operacional: hoje a única visibilidade de falha do WAHA é o histórico e o log do worker; um aviso pausado por 3 falhas não notifica ninguém (candidato: enviar uma linha no grupo da franqueadora ou e-mail do administrador).
- A fila `whatsapp-notices` tem concorrência 1 por desenho; se um dia houver avisos muito grandes (dezenas de destinos × 1,5 s) competindo com um horário popular, considerar `WORKER_NOTICE_CONCURRENCY` com um semáforo por organização em vez de global.
- `import:whatsapp-groups` é um script único; se o `daily` continuar a ser a fonte dos grupos por muito tempo, trocar por sincronização (ou por uma tela de importação) em vez de rodar o `docker compose run` a cada mudança.
- Arquivar avisos `concluido`/`cancelado` antigos e deliveries com mais de N dias (hoje a tela mostra 200; o banco guarda tudo).
- Mídia (imagem) nos avisos via `sendImage` do WAHA.
- Reutilizar `ChatIdField` na tela de Usuários para o administrador preencher o número de outros usuários.

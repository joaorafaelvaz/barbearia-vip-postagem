/**
 * Avisos WhatsApp: regras puras compartilhadas entre web (valida, enfileira) e worker (envia).
 * Comportamento espelhado de daily/admin/agendamentos.py e scheduler/agendamentos_job.py.
 */
import { localToUtc, utcToLocal } from "./timezone.js";

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
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

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

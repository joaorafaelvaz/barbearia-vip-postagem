import type { WahaSenderLike } from "@fsp/connectors";
import { NOTICE_TEXT_MAX, NOTICE_TIMEZONE, canTransition, localToUtc, nextOccurrence, resolveNoticeTargets, sameRecurrence, utcToLocal, type NoticeRecurrence, type NoticeState, type NoticeTargets, type NoticeUnitChat } from "@fsp/core";
import type { Prisma, PrismaClient } from "@fsp/db";
import { dequeueNotice, enqueueNotice, type NoticeQueueLike } from "@fsp/queue";
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
  // Data impossível (31/02, 25:00...) passa no regex e "rola" para outro dia: o round-trip denuncia.
  if (utcToLocal(firstSendAt, NOTICE_TIMEZONE) !== input.firstSendLocal) throw new HttpError(400, "Data/hora inválida.");
  const unchanged = opts.previousFirstSendAt !== undefined && opts.previousFirstSendAt.getTime() === firstSendAt.getTime();
  if (!unchanged && firstSendAt.getTime() < now.getTime() + 60_000) throw new HttpError(400, "A data/hora do primeiro envio precisa estar no futuro.");
  const recurrence = input.recurrence;
  if (recurrence.tipo === "semanal") {
    recurrence.dias = [...new Set(recurrence.dias)].sort((a, b) => a - b);
    if (recurrence.dias.length === 0) throw new HttpError(400, "Marque ao menos um dia da semana.");
  }
  if (recurrence.tipo === "mensal" && recurrence.dia !== "ultimo" && (recurrence.dia < 1 || recurrence.dia > 31)) throw new HttpError(400, 'Dia do mês inválido (1 a 31 ou "ultimo").');
  let endAt: Date | null = null;
  if (input.endDate) {
    endAt = localToUtc(`${input.endDate}T23:59`, NOTICE_TIMEZONE);
    if (utcToLocal(endAt, NOTICE_TIMEZONE).slice(0, 10) !== input.endDate) throw new HttpError(400, "Data final inválida.");
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
/** Só `ativo`/`pausado` podem ser editados: `enviando` -> 409 (aguarde), concluído/cancelado -> 404 (não aparecem mais na tela). */
export function assertEditable(state: NoticeState): void {
  if (state === "enviando") throw new HttpError(409, "Este aviso está sendo enviado agora; aguarde e tente de novo.");
  if (state !== "ativo" && state !== "pausado") throw new HttpError(404, "Aviso não encontrado.");
}

export function planUpdate(current: CurrentNotice, next: Pick<ParsedNotice, "firstSendAt" | "recurrence" | "endAt">, now: Date = new Date()): { state: NoticeState; nextRunAt: Date | null } {
  assertEditable(current.state);
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

/** Fila própria dos avisos (`whatsapp-notices`), nunca a `publish`. */
export interface NoticeDeps { prisma: PrismaClient; queue: NoticeQueueLike; log?: (msg: string, meta?: Record<string, unknown>) => void }

const defaultLog = (msg: string, meta?: Record<string, unknown>) => console.warn(JSON.stringify({ ts: new Date().toISOString(), msg, ...meta }));

/**
 * Operações de fila depois da escrita no banco nunca viram 500: o banco é a fonte da verdade e a
 * reconciliação do worker (a cada 5 min) reenfileira o que falta / ignora job de ocorrência antiga.
 */
async function queueSafely(deps: NoticeDeps, op: string, meta: Record<string, unknown>, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    (deps.log ?? defaultLog)("notice queue failed", { op, ...meta, error: err instanceof Error ? err.message : String(err) });
  }
}

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
  if (nextRunAt) await queueSafely(deps, "enqueue", { noticeId: notice.id }, () => enqueueNotice(deps.queue, notice.id, nextRunAt, 0));
  return notice;
}

export async function updateNotice(deps: NoticeDeps, organizationId: string, noticeId: string, raw: unknown) {
  const current = await deps.prisma.whatsappNotice.findFirst({ where: { id: noticeId, organizationId } });
  if (!current) throw new HttpError(404, "Aviso não encontrado.");
  assertEditable(current.state); // antes de validar a entrada: editar um cancelado/concluído é 404 mesmo com dados ruins
  const input = parseNoticeInput(raw, new Date(), { previousFirstSendAt: current.firstSendAt });
  await assertUnitsInOrg(deps.prisma, organizationId, input.targets.unidades);
  const chats = await loadChats(deps.prisma, organizationId);
  assertResolvableTargets(input.targets, chats.units, chats.franchisorChatId);
  const plan = planUpdate({ state: current.state, firstSendAt: current.firstSendAt, recurrence: current.recurrence as unknown as NoticeRecurrence, nextRunAt: current.nextRunAt }, input);
  // O estado é decidido no próprio UPDATE: se outra requisição pausou/retomou no meio, prevalece o banco.
  const r = await deps.prisma.whatsappNotice.updateMany({
    where: { id: noticeId, organizationId, state: { in: ["ativo", "pausado"] } },
    data: { text: input.text, targets: json(input.targets), firstSendAt: input.firstSendAt, recurrence: json(input.recurrence), endAt: input.endAt, nextRunAt: plan.nextRunAt, consecutiveFailures: 0, ...(plan.state === "concluido" ? { state: "concluido" as const } : {}) },
  });
  if (r.count === 0) throw new HttpError(409, "Este aviso mudou de estado; recarregue a página.");
  if (current.nextRunAt) await queueSafely(deps, "dequeue", { noticeId }, () => dequeueNotice(deps.queue, noticeId, current.nextRunAt as Date, current.consecutiveFailures));
  const updated = await deps.prisma.whatsappNotice.findUniqueOrThrow({ where: { id: noticeId }, select: noticeSelect });
  if (updated.state === "ativo" && updated.nextRunAt) await queueSafely(deps, "enqueue", { noticeId }, () => enqueueNotice(deps.queue, noticeId, updated.nextRunAt as Date, 0));
  return updated;
}

/** Pausar / retomar / cancelar pela tela (lista branca da spec §5.3). */
export async function changeNoticeState(deps: NoticeDeps, organizationId: string, noticeId: string, to: "ativo" | "pausado" | "cancelado") {
  const current = await deps.prisma.whatsappNotice.findFirst({ where: { id: noticeId, organizationId } });
  if (!current) throw new HttpError(404, "Aviso não encontrado.");
  if (!canTransition(current.state, to)) throw new HttpError(409, `Não é possível mudar de ${current.state} para ${to}.`);
  // Retomar zera o contador: senão um aviso pausado por 3 falhas pausa de novo na primeira falha
  const r = await deps.prisma.whatsappNotice.updateMany({ where: { id: noticeId, organizationId, state: current.state }, data: { state: to, ...(to === "ativo" ? { consecutiveFailures: 0 } : {}) } });
  if (r.count === 0) throw new HttpError(409, "Este aviso mudou de estado; recarregue a página.");
  const nextRunAt = current.nextRunAt;
  if (nextRunAt) {
    if (to === "ativo") await queueSafely(deps, "enqueue", { noticeId, to }, () => enqueueNotice(deps.queue, noticeId, nextRunAt, 0)); // vencido? a regra das 2h decide no worker
    else await queueSafely(deps, "dequeue", { noticeId, to }, () => dequeueNotice(deps.queue, noticeId, nextRunAt, current.consecutiveFailures));
  }
}

/** "Enviar teste para mim": imediato, só para o User.whatsappChatId do próprio usuário. */
export async function sendTestNotice(prisma: PrismaClient, sender: WahaSenderLike | null, userId: string, raw: unknown) {
  const { text } = z.object({ text: z.string().trim().min(1, "Escreva o texto antes de testar.").max(NOTICE_TEXT_MAX) }).parse(raw);
  if (!sender) throw new HttpError(503, "Envio de WhatsApp não configurado (WAHA_URL).");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { whatsappChatId: true } });
  if (!user.whatsappChatId) throw new HttpError(400, "Cadastre seu número em Minha conta para receber o teste.");
  const result = await sender.sendText(user.whatsappChatId, text);
  if (!result.ok) throw new HttpError(502, `Falha ao enviar o teste (${result.error}).`);
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

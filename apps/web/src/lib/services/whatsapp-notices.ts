import { NOTICE_TEXT_MAX, NOTICE_TIMEZONE, localToUtc, nextOccurrence, resolveNoticeTargets, sameRecurrence, type NoticeRecurrence, type NoticeState, type NoticeTargets, type NoticeUnitChat } from "@fsp/core";
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
    recurrence.dias = [...new Set(recurrence.dias)].sort((a, b) => a - b);
    if (recurrence.dias.length === 0) throw new HttpError(400, "Marque ao menos um dia da semana.");
  }
  if (recurrence.tipo === "mensal" && recurrence.dia !== "ultimo" && (recurrence.dia < 1 || recurrence.dia > 31)) throw new HttpError(400, 'Dia do mês inválido (1 a 31 ou "ultimo").');
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

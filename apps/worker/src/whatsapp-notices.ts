import {
  NOTICE_MAX_DELAY_MS, NOTICE_MAX_FAILURES, NOTICE_RETRY_DELAY_MS, NOTICE_SEND_INTERVAL_MS, NOTICE_STALE_SENDING_MS, OVERDUE_GRACE_MS,
  nextOccurrence, resolveNoticeTargets,
  type DeliveryStatus, type NoticeRecurrence, type NoticeState, type NoticeTargets, type NoticeUnitChat, type WhatsappNoticeJobData,
} from "@fsp/core";
import type { WahaSenderLike } from "@fsp/connectors";
import { enqueueNotice, hasNoticeJob, type NoticeQueueLike } from "@fsp/queue";

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
  /** `enviando` sem heartbeat desde `before` (ou sem `sendingStartedAt`), com o que a reconciliação precisa para reenfileirar. */
  listStaleSending(before: Date): Promise<Array<{ id: string; nextRunAt: Date | null; consecutiveFailures: number }>>;
  /** `enviando` -> `ativo`, só se o heartbeat continua anterior a `before` (um ciclo vivo entre listar e soltar não é liberado). */
  releaseStale(id: string, before: Date): Promise<boolean>;
  /** `ativo` com nextRunAt e `updatedAt < updatedBefore` (carência: não atropela um job recém-enfileirado). */
  listActive(updatedBefore: Date): Promise<Array<{ id: string; nextRunAt: Date; consecutiveFailures: number }>>;
}

export interface NoticeDeps {
  repo: NoticeRepository;
  queue: NoticeQueueLike;
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
const STATE_CHANGED = "estado mudou durante o envio";

/** Passos 1–5 da spec §5.2 (porta de `_processar_um` do daily). */
export async function processNotice(deps: NoticeDeps, data: WhatsappNoticeJobData): Promise<NoticeOutcome> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const occurrenceAt = new Date(data.occurrenceAt);
  const meta = { noticeId: data.noticeId, occurrenceAt: data.occurrenceAt };
  const skipped = (reason: string): NoticeOutcome => {
    log("notice skipped", { ...meta, reason });
    return { outcome: "skipped", reason };
  };

  const notice = await deps.repo.loadNotice(data.noticeId);
  if (!notice) return skipped("aviso inexistente");
  if (!(await deps.repo.claim(notice.id, occurrenceAt))) return skipped("não reservado");

  /** Fecha o ciclo com sucesso e enfileira a próxima; null se o aviso foi pausado/cancelado durante o envio. */
  const advance = async (): Promise<NoticeState | null> => {
    const next = nextOccurrence(occurrenceAt, notice.firstSendAt, notice.recurrence, notice.endAt);
    const state: NoticeState = next ? "ativo" : "concluido";
    if (!(await deps.repo.finishCycle(notice.id, { state, nextRunAt: next, consecutiveFailures: 0 }))) {
      log("notice cancelled during send", { ...meta });
      return null;
    }
    if (next) await enqueueNotice(deps.queue, notice.id, next, 0, now());
    return state;
  };
  const fail = async (reason: string, forcePause = false): Promise<NoticeOutcome> => {
    const failures = notice.consecutiveFailures + 1;
    const pause = forcePause || failures >= NOTICE_MAX_FAILURES;
    const done = await deps.repo.finishCycle(notice.id, { state: pause ? "pausado" : "ativo", nextRunAt: occurrenceAt, consecutiveFailures: failures });
    if (!done) {
      log("notice cancelled during send", { ...meta, reason });
      return skipped(STATE_CHANGED);
    }
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
      if ((await advance()) === null) return skipped(STATE_CHANGED);
      log("notice missed", { ...meta, targets: targets.length });
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
      const result = deps.sender ? await deps.sender.sendText(t.chatId, notice.text) : { ok: false as const, error: "WAHA_URL não configurada" };
      sentNow++;
      await deps.repo.recordDelivery({ noticeId: notice.id, organizationId: notice.organizationId, occurrenceAt, chatId: t.chatId, targetName: t.name, status: result.ok ? "enviado" : "falhou", error: result.ok ? undefined : result.error });
      if (result.ok) { sent++; anyOk = true; } else failed++;
      await deps.repo.touchSending(notice.id); // heartbeat: 30 destinos x 1,5 s + 2 tentativas do WAHA passam de 10 min
    }

    // 4./5. >=1 enviado avança; todos falharam -> falha do ciclo sem avançar
    if (!anyOk) return await fail("todos os destinos falharam");
    const state = await advance();
    if (state === null) return skipped(STATE_CHANGED);
    log("notice sent", { ...meta, sent, failed, state });
    return { outcome: "sent", sent, failed };
  } catch (err) {
    log("notice error", { ...meta, error: err instanceof Error ? err.message : String(err) });
    try {
      return await fail("exceção no envio");
    } catch (err2) {
      // Não deixa uma linha ruim derrubar o job; a reconciliação solta o `enviando` em 10 min
      log("notice error", { ...meta, error: `falha ao fechar o ciclo: ${err2 instanceof Error ? err2.message : String(err2)}` });
      return skipped("falha ao fechar o ciclo");
    }
  }
}

export interface NoticeReconcileSummary {
  /** `enviando` sem heartbeat há 10 min soltos (e reenfileirados para já na mesma passada). */
  staleReleased: number;
  /** `ativo` sem job na fila reenfileirados. */
  requeued: number;
}

/** Passos 0–1 da spec §5.2: solta `enviando` presos (reenfileirando na hora) e reenfileira ativos sem job (Redis recriado etc.). */
export async function reconcileNotices(deps: { repo: NoticeRepository; queue: NoticeQueueLike; now?: () => Date; log?: NoticeDeps["log"] }): Promise<NoticeReconcileSummary> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const summary: NoticeReconcileSummary = { staleReleased: 0, requeued: 0 };
  const staleBefore = new Date(now().getTime() - NOTICE_STALE_SENDING_MS);
  for (const n of await deps.repo.listStaleSending(staleBefore)) {
    // Passa `before` de novo: um heartbeat entre listar e soltar significa ciclo vivo -> não libera.
    if (!(await deps.repo.releaseStale(n.id, staleBefore))) continue;
    summary.staleReleased++;
    // Soltar atualiza `updatedAt`, então a carência abaixo não veria este aviso: reenfileira já, para agora
    // (a regra das 2 h decide se ainda envia). jobId com a tentativa atual: idempotente se o job ainda existir.
    if (n.nextRunAt) await enqueueNotice(deps.queue, n.id, n.nextRunAt, n.consecutiveFailures, now(), now());
    log("notice released", { noticeId: n.id, nextRunAt: n.nextRunAt?.toISOString() ?? null });
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

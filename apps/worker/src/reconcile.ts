import { OVERDUE_GRACE_MS, STALE_PUBLISHING_MS } from "@fsp/core";
import { hasPublishJob, requeuePublish, type PublishQueueLike } from "@fsp/queue";

export interface ReconcileRepository {
  /** PUBLISHING cuja última atualização é anterior a `before`. */
  listStalePublishing(before: Date): Promise<Array<{ id: string }>>;
  /** Todos os SCHEDULED criados antes de `createdBefore` (os recém-criados ainda podem estar sendo enfileirados). */
  listScheduled(createdBefore: Date): Promise<Array<{ id: string; scheduledAt: Date }>>;
  /** Volta para SCHEDULED mantendo attempts, com nota em lastError. */
  resetToScheduled(id: string, note: string): Promise<void>;
}

export interface ReconcileSummary {
  stalledReset: number;
  /** SCHEDULED (vencidos ou futuros) que estavam sem job na fila e foram reenfileirados. */
  requeued: number;
}

/**
 * Retoma o que ficou para trás: publicações presas em PUBLISHING (worker caiu no meio) voltam
 * à fila; qualquer agendamento sem job na fila (Redis recriado, migração de servidor, job
 * perdido) é reenfileirado para o seu horário, ou para já se estiver vencido.
 */
export async function reconcileTargets(
  deps: { repo: ReconcileRepository; queue: PublishQueueLike; now?: () => Date; log?: (msg: string, meta?: Record<string, unknown>) => void },
): Promise<ReconcileSummary> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const summary: ReconcileSummary = { stalledReset: 0, requeued: 0 };

  const stale = await deps.repo.listStalePublishing(new Date(now().getTime() - STALE_PUBLISHING_MS));
  for (const t of stale) {
    await deps.repo.resetToScheduled(t.id, "[STALLED] Publicação interrompida; reenfileirada automaticamente.");
    await requeuePublish(deps.queue, t.id, now(), now());
    summary.stalledReset++;
  }

  const scheduled = await deps.repo.listScheduled(new Date(now().getTime() - OVERDUE_GRACE_MS));
  for (const t of scheduled) {
    if (await hasPublishJob(deps.queue, t.id)) continue;
    const runAt = t.scheduledAt.getTime() > now().getTime() ? t.scheduledAt : now();
    await requeuePublish(deps.queue, t.id, runAt, now());
    summary.requeued++;
  }

  if (summary.stalledReset || summary.requeued) log("reconcile", { ...summary });
  return summary;
}

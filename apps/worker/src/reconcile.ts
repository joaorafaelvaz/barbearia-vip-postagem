import { OVERDUE_GRACE_MS, STALE_PUBLISHING_MS } from "@fsp/core";
import { hasPublishJob, requeuePublish, type PublishQueueLike } from "@fsp/queue";

export interface ReconcileRepository {
  /** PUBLISHING cuja última atualização é anterior a `before`. */
  listStalePublishing(before: Date): Promise<Array<{ id: string }>>;
  /** SCHEDULED com scheduledAt anterior a `before`. */
  listOverdueScheduled(before: Date): Promise<Array<{ id: string; scheduledAt: Date }>>;
  /** Volta para SCHEDULED mantendo attempts, com nota em lastError. */
  resetToScheduled(id: string, note: string): Promise<void>;
}

export interface ReconcileSummary {
  stalledReset: number;
  overdueRequeued: number;
}

/**
 * Retoma o que ficou para trás: publicações presas em PUBLISHING (worker caiu no meio) voltam
 * à fila; agendamentos vencidos sem job (Redis perdeu o job) são reenfileirados.
 */
export async function reconcileTargets(
  deps: { repo: ReconcileRepository; queue: PublishQueueLike; now?: () => Date; log?: (msg: string, meta?: Record<string, unknown>) => void },
): Promise<ReconcileSummary> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const summary: ReconcileSummary = { stalledReset: 0, overdueRequeued: 0 };

  const stale = await deps.repo.listStalePublishing(new Date(now().getTime() - STALE_PUBLISHING_MS));
  for (const t of stale) {
    await deps.repo.resetToScheduled(t.id, "[STALLED] Publicação interrompida; reenfileirada automaticamente.");
    await requeuePublish(deps.queue, t.id, now(), now());
    summary.stalledReset++;
  }

  const overdue = await deps.repo.listOverdueScheduled(new Date(now().getTime() - OVERDUE_GRACE_MS));
  for (const t of overdue) {
    if (await hasPublishJob(deps.queue, t.id)) continue;
    await requeuePublish(deps.queue, t.id, now(), now());
    summary.overdueRequeued++;
  }

  if (summary.stalledReset || summary.overdueRequeued) log("reconcile", { ...summary });
  return summary;
}

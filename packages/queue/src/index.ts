import { RECONCILE_EVERY_MS, RECONCILE_JOB_NAME, RECONCILE_SCHEDULER_ID, IMPORT_EVERY_MS, IMPORT_JOB_NAME, IMPORT_SCHEDULER_ID, METRICS_EVERY_MS, METRICS_JOB_NAME, METRICS_SCHEDULER_ID, PUBLISH_QUEUE_NAME, delayUntil, publishJobId, type ImportJobData, type MetricsJobData, type PublishJobData } from "@fsp/core";
import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

export { PUBLISH_QUEUE_NAME } from "@fsp/core";
export type { PublishJobData, MetricsJobData, ImportJobData } from "@fsp/core";
export { METRICS_JOB_NAME, IMPORT_JOB_NAME, RECONCILE_JOB_NAME } from "@fsp/core";

export function createRedisConnection(url: string = process.env.REDIS_URL ?? "redis://localhost:6379"): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

/** Interface mínima da fila para permitir fakes em testes. */
export interface PublishQueueLike {
  add(name: string, data: PublishJobData, opts?: JobsOptions): Promise<unknown>;
  getJob(jobId: string): Promise<{ remove(): Promise<void>; getState(): Promise<string> } | undefined | null>;
}

export type AppJobData = PublishJobData | MetricsJobData | ImportJobData;

export function createPublishQueue(connection: Redis): Queue<AppJobData> {
  return new Queue<AppJobData>(PUBLISH_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  });
}

/**
 * Enfileira (ou re-enfileira) a publicação de um PostTarget.
 * O jobId determinístico garante que chamadas repetidas não dupliquem o job.
 * `attempts: 1` porque a retentativa é controlada pelo worker com backoff próprio.
 */
export async function enqueuePublish(
  queue: PublishQueueLike,
  postTargetId: string,
  scheduledAt: Date,
  now: Date = new Date(),
): Promise<void> {
  await queue.add(
    "publish",
    { postTargetId },
    { jobId: publishJobId(postTargetId), delay: delayUntil(scheduledAt, now), attempts: 1 },
  );
}

/** Remove o job pendente de um target (cancelamento). Retorna true se havia job. */
export async function dequeuePublish(queue: PublishQueueLike, postTargetId: string): Promise<boolean> {
  const job = await queue.getJob(publishJobId(postTargetId));
  if (!job) return false;
  const state = await job.getState();
  if (state === "active") return false;
  await job.remove();
  return true;
}

/** Re-enfileira após falha ou para "re-tentar" manual: remove o job antigo e agenda de novo. */
export async function requeuePublish(
  queue: PublishQueueLike,
  postTargetId: string,
  runAt: Date,
  now: Date = new Date(),
): Promise<void> {
  await dequeuePublish(queue, postTargetId);
  await enqueuePublish(queue, postTargetId, runAt, now);
}

/** Garante o agendador repetitivo da coleta de métricas (idempotente). */
export async function ensureMetricsScheduler(queue: Queue<AppJobData>): Promise<void> {
  await queue.upsertJobScheduler(METRICS_SCHEDULER_ID, { every: METRICS_EVERY_MS }, { name: METRICS_JOB_NAME, data: {} });
}

/** Coleta imediata para uma organização. jobId fixo: enquanto houver uma coleta pendente ou em andamento, novas chamadas são ignoradas. */
export async function enqueueMetricsNow(queue: PublishQueueLike, organizationId: string): Promise<void> {
  await queue.add(METRICS_JOB_NAME, { organizationId } as never, { jobId: `metrics-${organizationId}`, attempts: 1, removeOnComplete: true, removeOnFail: true });
}

/** Agendador diário da importação de publicações externas (idempotente). */
export async function ensureImportScheduler(queue: Queue<AppJobData>): Promise<void> {
  await queue.upsertJobScheduler(IMPORT_SCHEDULER_ID, { every: IMPORT_EVERY_MS }, { name: IMPORT_JOB_NAME, data: {} });
}

/** Importação imediata (botão ou logo após conectar uma conta). jobId fixo por organização/conta: não duplica enquanto houver uma em andamento. */
export async function enqueueImportNow(queue: PublishQueueLike, data: ImportJobData): Promise<void> {
  const key = data.connectedAccountId ?? data.organizationId ?? "all";
  await queue.add(IMPORT_JOB_NAME, data as never, { jobId: `import-${key}`, attempts: 1, removeOnComplete: true, removeOnFail: true });
}

/** Agendador da reconciliação (idempotente). */
export async function ensureReconcileScheduler(queue: Queue<AppJobData>): Promise<void> {
  await queue.upsertJobScheduler(RECONCILE_SCHEDULER_ID, { every: RECONCILE_EVERY_MS }, { name: RECONCILE_JOB_NAME, data: {} });
}

/** Há job (pendente ou ativo) para o target? */
export async function hasPublishJob(queue: PublishQueueLike, postTargetId: string): Promise<boolean> {
  return Boolean(await queue.getJob(publishJobId(postTargetId)));
}

import { PUBLISH_QUEUE_NAME, delayUntil, publishJobId, type PublishJobData } from "@fsp/core";
import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";

export { PUBLISH_QUEUE_NAME } from "@fsp/core";
export type { PublishJobData } from "@fsp/core";

export function createRedisConnection(url: string = process.env.REDIS_URL ?? "redis://localhost:6379"): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false });
}

/** Interface mínima da fila para permitir fakes em testes. */
export interface PublishQueueLike {
  add(name: string, data: PublishJobData, opts?: JobsOptions): Promise<unknown>;
  getJob(jobId: string): Promise<{ remove(): Promise<void>; getState(): Promise<string> } | undefined | null>;
}

export function createPublishQueue(connection: Redis): Queue<PublishJobData> {
  return new Queue<PublishJobData>(PUBLISH_QUEUE_NAME, {
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

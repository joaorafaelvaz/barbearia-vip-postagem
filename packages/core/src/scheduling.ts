/** Regras puras de agendamento compartilhadas entre web (enfileira) e worker (processa). */

export const PUBLISH_QUEUE_NAME = "publish";

export const MAX_ATTEMPTS = 5;

/** Job id determinístico: enfileirar o mesmo target duas vezes não cria dois jobs. */
export function publishJobId(postTargetId: string): string {
  return `post-target-${postTargetId}`;
}

/** Delay (ms) até o horário agendado; nunca negativo. */
export function delayUntil(scheduledAt: Date, now: Date = new Date()): number {
  return Math.max(0, scheduledAt.getTime() - now.getTime());
}

/**
 * Backoff exponencial com teto: 30s, 60s, 120s, 240s, 480s...
 * `retryAfterSeconds` (vindo de rate limit) tem precedência quando maior.
 */
export function backoffMs(attemptsMade: number, retryAfterSeconds?: number): number {
  const base = 30_000 * 2 ** Math.max(0, attemptsMade - 1);
  const capped = Math.min(base, 30 * 60_000);
  const hinted = retryAfterSeconds !== undefined ? retryAfterSeconds * 1000 : 0;
  return Math.max(capped, hinted);
}

export type TargetStatus = "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "FAILED" | "CANCELLED";

/** Payload do job de publicação. Só ids: o worker recarrega tudo do banco. */
export interface PublishJobData {
  postTargetId: string;
}

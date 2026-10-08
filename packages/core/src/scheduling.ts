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

/** Coleta periódica de métricas de engajamento (mesma fila, outro nome de job). */
export const METRICS_JOB_NAME = "collect-metrics";
export const METRICS_SCHEDULER_ID = "collect-metrics-every-6h";
export const METRICS_EVERY_MS = 6 * 60 * 60_000;
/** Janela: publicações dos últimos N dias têm métricas atualizadas. */
export const METRICS_WINDOW_DAYS = 30;

export interface MetricsJobData {
  /** organização específica (atualização manual) ou undefined para todas */
  organizationId?: string;
}

/** Importação de publicações existentes nas plataformas (feitas fora do sistema). */
export const IMPORT_JOB_NAME = "import-posts";
export const IMPORT_SCHEDULER_ID = "import-posts-daily";
export const IMPORT_EVERY_MS = 24 * 60 * 60_000;
export const IMPORT_WINDOW_DAYS = 90;

export interface ImportJobData {
  organizationId?: string;
  /** só uma conta (logo após conectar) */
  connectedAccountId?: string;
}

/** Reconciliação: retoma publicações presas em PUBLISHING e reenfileira agendamentos vencidos sem job. */
export const RECONCILE_JOB_NAME = "reconcile-targets";
export const RECONCILE_SCHEDULER_ID = "reconcile-every-5min";
export const RECONCILE_EVERY_MS = 5 * 60_000;
/** PUBLISHING há mais que isso é considerado preso (o worker caiu ou o job falhou sem tratamento). */
export const STALE_PUBLISHING_MS = 15 * 60_000;
/** SCHEDULED vencido há mais que isso sem job na fila é reenfileirado. */
export const OVERDUE_GRACE_MS = 2 * 60_000;

/**
 * Preparação de mídia: corte de vídeo longo em partes para Stories. Disparado ao agendar
 * (para já estar pronto na hora) e sob demanda na publicação, se ainda não existir.
 */
export const PREPARE_MEDIA_JOB_NAME = "prepare-media";
export interface PrepareMediaJobData {
  mediaId: string;
}

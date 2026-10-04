import type { AccountCredentials, InsightsFetcher, PostMetrics } from "@fsp/connectors";

export type MetricsSource = "system" | "external";
import { METRICS_WINDOW_DAYS, toPublishError, type Platform } from "@fsp/core";

/** Publicação elegível para coleta: publicada, com id externo, conta ativa. */
export interface MetricsTarget {
  id: string;
  /** publicação do sistema (PostTarget) ou importada (ExternalPost) */
  source: MetricsSource;
  externalPostId: string;
  account: {
    id: string;
    platform: Platform;
    externalId: string;
    accessTokenEnc: string;
    refreshTokenEnc: string | null;
    tokenExpiresAt: Date | null;
  };
}

export interface MetricsRepository {
  /** Publicadas na janela, de uma organização ou de todas; menos atualizadas primeiro. */
  listTargets(opts: { organizationId?: string; since: Date; limit: number }): Promise<MetricsTarget[]>;
  saveMetrics(target: MetricsTarget, m: PostMetrics): Promise<void>;
  saveError(target: MetricsTarget, error: string): Promise<void>;
}

export interface MetricsDeps {
  repo: MetricsRepository;
  fetcherFor(platform: Platform): InsightsFetcher;
  /** Resolve o token em claro (renova o do Google quando preciso). */
  credentials(t: MetricsTarget): Promise<AccountCredentials>;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
  now?: () => Date;
  /** pausa entre chamadas para respeitar limites das APIs */
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface MetricsSummary {
  scanned: number;
  updated: number;
  failed: number;
}

export async function collectMetrics(deps: MetricsDeps, organizationId?: string): Promise<MetricsSummary> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pause = deps.pauseMs ?? 250;
  const since = new Date(now().getTime() - METRICS_WINDOW_DAYS * 86_400_000);
  const targets = await deps.repo.listTargets({ ...(organizationId ? { organizationId } : {}), since, limit: 500 });
  const summary: MetricsSummary = { scanned: targets.length, updated: 0, failed: 0 };
  for (const t of targets) {
    try {
      const creds = await deps.credentials(t);
      const m = await deps.fetcherFor(t.account.platform).fetch(creds, t.externalPostId);
      await deps.repo.saveMetrics(t, m);
      summary.updated++;
    } catch (err) {
      const perr = toPublishError(err);
      await deps.repo.saveError(t, perr.toPersisted());
      summary.failed++;
      log("metrics failed", { postTargetId: t.id, code: perr.code });
      if (perr.code === "RATE_LIMITED") await sleep(Math.max(pause, (perr.retryAfterSeconds ?? 60) * 1000));
    }
    if (pause > 0) await sleep(pause);
  }
  log("metrics done", { ...summary, organizationId: organizationId ?? "all" });
  return summary;
}

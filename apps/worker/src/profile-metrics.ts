import type { AccountCredentials, ProfileDailyPoint } from "@fsp/connectors";
import { PROFILE_METRICS_WINDOW_DAYS, toPublishError, type Platform } from "@fsp/core";

/** Conta do Google Meu Negócio elegível para o desempenho do perfil. */
export interface ProfileAccount {
  id: string;
  organizationId: string;
  platform: Platform;
  externalId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  tokenExpiresAt: Date | null;
}

export interface ProfileMetricsRepository {
  /** Contas ativas do Google Business Profile, de uma organização ou de todas. */
  listGoogleAccounts(filter: { organizationId?: string }): Promise<ProfileAccount[]>;
  /** Grava (insere ou atualiza) os dias devolvidos e limpa o erro da conta. */
  savePoints(account: ProfileAccount, points: ProfileDailyPoint[], fetchedAt: Date): Promise<void>;
  /** Registra a falha da coleta na conta, sem apagar os dias já gravados. */
  saveError(account: ProfileAccount, error: string, fetchedAt: Date): Promise<void>;
}

export interface ProfileMetricsDeps {
  repo: ProfileMetricsRepository;
  fetchDaily(creds: AccountCredentials, from: Date, to: Date): Promise<ProfileDailyPoint[]>;
  credentials(a: ProfileAccount): Promise<AccountCredentials>;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
  now?: () => Date;
  /** dias para trás (padrão PROFILE_METRICS_WINDOW_DAYS) */
  windowDays?: number;
}

export interface ProfileMetricsSummary { accounts: number; updated: number; failed: number; days: number }

const DAY_MS = 86_400_000;
const utcMidnight = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Coleta o desempenho diário do perfil (impressões, cliques, ligações, rotas) de cada conta do Google.
 * A janela termina em ontem: o Google publica os dados com alguns dias de atraso e o dia corrente
 * nunca está completo. Uma conta com erro não interrompe as demais.
 */
export async function collectProfileMetrics(deps: ProfileMetricsDeps, organizationId?: string): Promise<ProfileMetricsSummary> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const windowDays = deps.windowDays ?? PROFILE_METRICS_WINDOW_DAYS;
  const at = now();
  const to = new Date(utcMidnight(at).getTime() - DAY_MS);
  const from = new Date(to.getTime() - (windowDays - 1) * DAY_MS);
  const accounts = await deps.repo.listGoogleAccounts(organizationId ? { organizationId } : {});
  const summary: ProfileMetricsSummary = { accounts: accounts.length, updated: 0, failed: 0, days: 0 };
  for (const a of accounts) {
    try {
      const creds = await deps.credentials(a);
      const points = await deps.fetchDaily(creds, from, to);
      await deps.repo.savePoints(a, points, at);
      summary.updated++;
      summary.days += points.length;
    } catch (err) {
      const perr = toPublishError(err);
      await deps.repo.saveError(a, perr.toPersisted(), at);
      summary.failed++;
      log("profile metrics failed", { accountId: a.id, code: perr.code, message: perr.message });
    }
  }
  log("profile metrics done", { ...summary, organizationId: organizationId ?? "all" });
  return summary;
}

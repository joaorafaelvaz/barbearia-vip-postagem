import type { AccountCredentials, ExternalPostSummary, PostLister } from "@fsp/connectors";
import { IMPORT_WINDOW_DAYS, toPublishError, type Platform } from "@fsp/core";

export interface ImportAccount {
  id: string;
  organizationId: string;
  platform: Platform;
  externalId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  tokenExpiresAt: Date | null;
}

export interface ImportRepository {
  listAccounts(filter: { organizationId?: string; connectedAccountId?: string }): Promise<ImportAccount[]>;
  /** Insere ou atualiza (contagens e legenda) as publicações de uma conta. Devolve quantas são novas. */
  upsertPosts(account: ImportAccount, posts: ExternalPostSummary[]): Promise<number>;
}

export interface ImportDeps {
  repo: ImportRepository;
  listerFor(platform: Platform): PostLister;
  credentials(a: ImportAccount): Promise<AccountCredentials>;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
  now?: () => Date;
}

export interface ImportSummary { accounts: number; imported: number; created: number; failed: number }

/** Importa as publicações dos últimos IMPORT_WINDOW_DAYS dias de cada conta ativa. */
export async function importPosts(deps: ImportDeps, filter: { organizationId?: string; connectedAccountId?: string } = {}): Promise<ImportSummary> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const since = new Date(now().getTime() - IMPORT_WINDOW_DAYS * 86_400_000);
  const accounts = await deps.repo.listAccounts(filter);
  const summary: ImportSummary = { accounts: accounts.length, imported: 0, created: 0, failed: 0 };
  for (const a of accounts) {
    try {
      const creds = await deps.credentials(a);
      const posts = await deps.listerFor(a.platform).list(creds, since);
      summary.created += await deps.repo.upsertPosts(a, posts);
      summary.imported += posts.length;
    } catch (err) {
      summary.failed++;
      log("import failed", { accountId: a.id, platform: a.platform, code: toPublishError(err).code });
    }
  }
  log("import done", { ...summary, ...filter });
  return summary;
}

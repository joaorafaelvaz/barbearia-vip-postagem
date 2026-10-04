import type { MediaRef, Publisher, PublishInput } from "@fsp/connectors";
import {
  MAX_ATTEMPTS,
  backoffMs,
  toPublishError,
  type Platform,
  type TokenCipher,
} from "@fsp/core";

/** Visão do PostTarget que o processador precisa (carregada pelo repositório). */
export interface TargetRecord {
  id: string;
  organizationId: string;
  status: string;
  attempts: number;
  scheduledAt: Date;
  post: { caption: string; media: MediaRef[] };
  account: {
    id: string;
    organizationId: string;
    platform: Platform;
    externalId: string;
    accessTokenEnc: string;
    refreshTokenEnc: string | null;
    tokenExpiresAt: Date | null;
    isActive: boolean;
  };
}

export interface TargetRepository {
  loadTarget(id: string): Promise<TargetRecord | null>;
  /** Transição atômica SCHEDULED|FAILED -> PUBLISHING. false se não elegível. */
  markPublishing(id: string): Promise<boolean>;
  markPublished(id: string, result: { externalPostId: string; externalUrl?: string }): Promise<void>;
  markFailed(id: string, attempts: number, error: string): Promise<void>;
  /** Volta para SCHEDULED guardando erro e tentativas, para retentativa. */
  markRetry(id: string, attempts: number, error: string): Promise<void>;
  updateAccountToken(accountId: string, accessTokenEnc: string, expiresAt: Date): Promise<void>;
}

export interface GoogleTokenRefresher {
  refresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }>;
}

export interface ProcessorDeps {
  repo: TargetRepository;
  cipher: Pick<TokenCipher, "encrypt" | "decrypt">;
  publisherFor(platform: Platform): Publisher;
  google: GoogleTokenRefresher;
  now?: () => Date;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export type ProcessOutcome =
  | { outcome: "published"; externalPostId: string }
  | { outcome: "retry"; delayMs: number; error: string }
  | { outcome: "failed"; error: string }
  | { outcome: "skipped"; reason: string };

const TOKEN_REFRESH_MARGIN_MS = 2 * 60_000;

export async function processTarget(deps: ProcessorDeps, postTargetId: string): Promise<ProcessOutcome> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});

  const target = await deps.repo.loadTarget(postTargetId);
  if (!target) return { outcome: "skipped", reason: "target inexistente" };
  if (target.status === "PUBLISHED" || target.status === "CANCELLED") {
    return { outcome: "skipped", reason: `status ${target.status}` };
  }
  if (target.account.organizationId !== target.organizationId) {
    await deps.repo.markFailed(target.id, target.attempts + 1, "[VALIDATION] Conta de outra organização.");
    return { outcome: "failed", error: "conta de outra organização" };
  }
  if (!target.account.isActive) {
    await deps.repo.markFailed(target.id, target.attempts + 1, "[INVALID_TOKEN] Conta desconectada.");
    return { outcome: "failed", error: "conta desconectada" };
  }

  const claimed = await deps.repo.markPublishing(target.id);
  if (!claimed) return { outcome: "skipped", reason: "já em processamento" };

  const attempts = target.attempts + 1;
  try {
    const accessToken = await resolveAccessToken(deps, target, now());
    const input: PublishInput = {
      account: { platform: target.account.platform, externalId: target.account.externalId, accessToken },
      caption: target.post.caption,
      media: target.post.media,
    };
    const result = await deps.publisherFor(target.account.platform).publish(input);
    await deps.repo.markPublished(target.id, result);
    log("published", { postTargetId: target.id, platform: target.account.platform });
    return { outcome: "published", externalPostId: result.externalPostId };
  } catch (err) {
    const perr = toPublishError(err);
    const persisted = perr.toPersisted();
    if (perr.retryable && attempts < MAX_ATTEMPTS) {
      const delayMs = backoffMs(attempts, perr.retryAfterSeconds);
      await deps.repo.markRetry(target.id, attempts, persisted);
      log("retry", { postTargetId: target.id, code: perr.code, attempts, delayMs });
      return { outcome: "retry", delayMs, error: persisted };
    }
    await deps.repo.markFailed(target.id, attempts, persisted);
    log("failed", { postTargetId: target.id, code: perr.code, attempts });
    return { outcome: "failed", error: persisted };
  }
}

/** Token em claro da conta; renova o do Google quando está perto de expirar. Também usado pela coleta de métricas. */
export async function resolveAccessToken(deps: Pick<ProcessorDeps, "cipher" | "google" | "repo">, target: Pick<TargetRecord, "account">, now: Date): Promise<string> {
  const { account } = target;
  const current = deps.cipher.decrypt(account.accessTokenEnc);
  if (account.platform !== "GOOGLE_BUSINESS_PROFILE") return current;

  const expiresAt = account.tokenExpiresAt?.getTime() ?? 0;
  if (expiresAt - now.getTime() > TOKEN_REFRESH_MARGIN_MS) return current;
  if (!account.refreshTokenEnc) return current;

  const refreshed = await deps.google.refresh(deps.cipher.decrypt(account.refreshTokenEnc));
  await deps.repo.updateAccountToken(account.id, deps.cipher.encrypt(refreshed.accessToken), refreshed.expiresAt);
  return refreshed.accessToken;
}

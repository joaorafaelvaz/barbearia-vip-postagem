import type { Storage } from "./storage.js";

/** Mídia elegível para exclusão. */
export interface ExpiredMedia {
  id: string;
  storageKey: string;
  kind: string;
}

export interface CleanupRepository {
  /**
   * Mídias criadas antes de `before` que não estão ligadas a nenhuma postagem com alvo
   * SCHEDULED/PUBLISHING (nem como mídia, nem como capa, nem como parte de um vídeo pendente).
   */
  listExpired(before: Date, limit: number): Promise<ExpiredMedia[]>;
  /** Remove o registro; as ligações com postagens somem em cascata, a postagem fica. */
  deleteMedia(id: string): Promise<void>;
}

export interface CleanupSummary {
  deleted: number;
  failed: number;
  cutoff: string;
}

export interface CleanupDeps {
  repo: CleanupRepository;
  storage: Pick<Storage, "remove">;
  retentionDays: number;
  now?: () => Date;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
  batch?: number;
}

/**
 * Apaga do armazenamento e do banco as fotos e vídeos mais velhos que a retenção cujas
 * postagens já saíram (ou que nunca foram usados). Se a exclusão do arquivo falhar, o
 * registro fica para a próxima rodada.
 */
export async function cleanupMedia(deps: CleanupDeps): Promise<CleanupSummary> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const cutoff = new Date(now().getTime() - deps.retentionDays * 86_400_000);
  const summary: CleanupSummary = { deleted: 0, failed: 0, cutoff: cutoff.toISOString() };
  const batch = deps.batch ?? 500;
  for (let round = 0; round < 20; round++) {
    const expired = await deps.repo.listExpired(cutoff, batch);
    if (expired.length === 0) break;
    for (const m of expired) {
      try {
        await deps.storage.remove(m.storageKey);
        await deps.repo.deleteMedia(m.id);
        summary.deleted++;
      } catch (err) {
        summary.failed++;
        log("cleanup failed", { mediaId: m.id, key: m.storageKey, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (expired.length < batch) break;
  }
  log("cleanup done", { ...summary, retentionDays: deps.retentionDays });
  return summary;
}

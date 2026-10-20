import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "../../.env") });
loadEnv();
import { createInsightsFetcher, createPostLister, createPublisher, refreshGoogleAccessToken, refreshTikTokToken, type ConnectorOptions } from "@fsp/connectors";
import { CLEANUP_JOB_NAME, DEFAULT_MEDIA_RETENTION_DAYS, IMPORT_JOB_NAME, METRICS_JOB_NAME, PREPARE_MEDIA_JOB_NAME, PUBLISH_QUEUE_NAME, RECONCILE_JOB_NAME, TokenCipher, type ImportJobData, type MetricsJobData, type PrepareMediaJobData, type PublishJobData } from "@fsp/core";
import { getPrisma } from "@fsp/db";
import { createPublishQueue, createRedisConnection, ensureCleanupScheduler, ensureImportScheduler, ensureMetricsScheduler, ensureReconcileScheduler, requeuePublish, type AppJobData } from "@fsp/queue";
import { Worker } from "bullmq";
import { cleanupMedia } from "./cleanup.js";
import { importPosts } from "./imports.js";
import { collectMetrics } from "./metrics.js";
import { reconcileTargets } from "./reconcile.js";
import { processTarget, resolveAccessToken, type ProcessorDeps } from "./processor.js";
import { prismaCleanupRepository, prismaImportRepository, prismaMetricsRepository, prismaReconcileRepository, prismaSegmentRepository, prismaTargetRepository } from "./repository.js";
import { ensureNormalized, type NormalizeDeps } from "./normalize.js";
import { ffmpegTranscoder, ffprobeProber } from "./normalize-ffmpeg.js";
import { ensureStorySegments, ffmpegSplitter, type SegmentDeps } from "./segments.js";
import { getStorage, uploadsDir } from "./storage.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return v;
}

async function main(): Promise<void> {
  const prisma = getPrisma();
  const connection = createRedisConnection();
  const queue = createPublishQueue(connection);
  const cipher = TokenCipher.fromEnv();

  const googleCfg = {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri: `${process.env.AUTH_URL ?? "http://localhost:3022"}/api/oauth/google/callback`,
  };

  const log = (msg: string, meta?: Record<string, unknown>) => console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...meta }));
  const segmentRepo = prismaSegmentRepository(prisma);
  const storage = await getStorage();
  const segmentDeps: SegmentDeps = { repo: segmentRepo, storage, splitter: ffmpegSplitter(), log };
  const normalizeDeps: NormalizeDeps = { repo: segmentRepo, storage, prober: ffprobeProber(), transcoder: ffmpegTranscoder(), log };

  const tiktokCfg = {
    clientKey: process.env.TIKTOK_CLIENT_KEY ?? "",
    clientSecret: process.env.TIKTOK_CLIENT_SECRET ?? "",
    redirectUri: `${process.env.AUTH_URL ?? "http://localhost:3022"}/api/oauth/tiktok/callback`,
  };
  const publisherOptions: ConnectorOptions = {
    ...(process.env.TIKTOK_PRIVACY_LEVEL ? { tiktokPrivacyLevel: process.env.TIKTOK_PRIVACY_LEVEL } : {}),
    ...(process.env.YOUTUBE_PRIVACY_STATUS ? { youtubePrivacyStatus: process.env.YOUTUBE_PRIVACY_STATUS as ConnectorOptions["youtubePrivacyStatus"] } : {}),
  };

  const deps: ProcessorDeps = {
    repo: prismaTargetRepository(prisma),
    cipher,
    publisherFor: (platform) => createPublisher(platform, publisherOptions),
    ...(tiktokCfg.clientKey
      ? { tiktok: { refresh: async (rt: string) => { const t = await refreshTikTokToken(tiktokCfg, rt); return { accessToken: t.accessToken, expiresAt: t.expiresAt, refreshToken: t.refreshToken }; } } }
      : {}),
    segments: {
      ensure: (mediaId) => ensureStorySegments(segmentDeps, mediaId),
      normalize: async (mediaId) => { const r = await ensureNormalized(normalizeDeps, mediaId); return r ? { url: r.url } : null; },
    },
    google: {
      async refresh(refreshToken) {
        requireEnv("GOOGLE_CLIENT_ID");
        const t = await refreshGoogleAccessToken(googleCfg, refreshToken);
        return { accessToken: t.accessToken, expiresAt: t.expiresAt };
      },
    },
    log,
  };

  const metricsRepo = prismaMetricsRepository(prisma);
  const importRepo = prismaImportRepository(prisma);
  const reconcileRepo = prismaReconcileRepository(prisma);
  const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 5);
  const worker = new Worker<AppJobData>(
    PUBLISH_QUEUE_NAME,
    async (job) => {
      if (job.name === CLEANUP_JOB_NAME) {
        const retentionDays = Number(process.env.MEDIA_RETENTION_DAYS) || DEFAULT_MEDIA_RETENTION_DAYS;
        return cleanupMedia({ repo: prismaCleanupRepository(prisma), storage, retentionDays, log });
      }
      if (job.name === RECONCILE_JOB_NAME) {
        return reconcileTargets({ repo: reconcileRepo, queue, log: deps.log });
      }
      if (job.name === PREPARE_MEDIA_JOB_NAME) {
        const mediaId = (job.data as PrepareMediaJobData).mediaId;
        const normalized = await ensureNormalized(normalizeDeps, mediaId);
        const parts = await ensureStorySegments(segmentDeps, mediaId);
        return { normalized: normalized?.note ?? null, parts: parts.length };
      }
      if (job.name === IMPORT_JOB_NAME) {
        const data = job.data as ImportJobData;
        return importPosts(
          {
            repo: importRepo,
            listerFor: (platform) => createPostLister(platform),
            credentials: async (a) => ({
              platform: a.platform,
              externalId: a.externalId,
              accessToken: await resolveAccessToken(deps, { account: { ...a, isActive: true } }, new Date()),
            }),
            log: deps.log,
          },
          data,
        );
      }
      if (job.name === METRICS_JOB_NAME) {
        const data = job.data as MetricsJobData;
        return collectMetrics(
          {
            repo: metricsRepo,
            fetcherFor: (platform) => createInsightsFetcher(platform),
            credentials: async (t) => ({
              platform: t.account.platform,
              externalId: t.account.externalId,
              accessToken: await resolveAccessToken(deps, { account: { ...t.account, organizationId: "", isActive: true } }, new Date()),
            }),
            log: deps.log,
          },
          data.organizationId,
        );
      }
      const outcome = await processTarget(deps, (job.data as PublishJobData).postTargetId);
      if (outcome.outcome === "retry") {
        // Re-agenda com o backoff calculado. O job atual termina com sucesso.
        await requeuePublish(queue, (job.data as PublishJobData).postTargetId, new Date(Date.now() + outcome.delayMs));
      }
      return outcome;
    },
    { connection, concurrency },
  );

  worker.on("failed", (job, err) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), msg: "job failed", jobId: job?.id, error: err.message }));
  });
  worker.on("error", (err) => console.error("worker error", err.message));

  await ensureMetricsScheduler(queue);
  await ensureImportScheduler(queue);
  await ensureReconcileScheduler(queue);
  await ensureCleanupScheduler(queue);
  // Reconcilia já na subida: retoma o que ficou preso enquanto o worker esteve fora.
  await reconcileTargets({ repo: reconcileRepo, queue, log: deps.log });
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg: "worker started", queue: PUBLISH_QUEUE_NAME, concurrency, metricsScheduler: "6h", uploads: process.env.S3_BUCKET ? "s3" : uploadsDir() }));

  const shutdown = async () => {
    console.log("shutting down worker...");
    await worker.close();
    await queue.close();
    await prisma.$disconnect();
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

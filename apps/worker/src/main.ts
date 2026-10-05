import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "../../.env") });
loadEnv();
import { createInsightsFetcher, createPostLister, createPublisher, refreshGoogleAccessToken } from "@fsp/connectors";
import { IMPORT_JOB_NAME, METRICS_JOB_NAME, PUBLISH_QUEUE_NAME, RECONCILE_JOB_NAME, TokenCipher, type ImportJobData, type MetricsJobData, type PublishJobData } from "@fsp/core";
import { getPrisma } from "@fsp/db";
import { createPublishQueue, createRedisConnection, ensureImportScheduler, ensureMetricsScheduler, ensureReconcileScheduler, requeuePublish, type AppJobData } from "@fsp/queue";
import { Worker } from "bullmq";
import { importPosts } from "./imports.js";
import { collectMetrics } from "./metrics.js";
import { reconcileTargets } from "./reconcile.js";
import { processTarget, resolveAccessToken, type ProcessorDeps } from "./processor.js";
import { prismaImportRepository, prismaMetricsRepository, prismaReconcileRepository, prismaTargetRepository } from "./repository.js";

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

  const deps: ProcessorDeps = {
    repo: prismaTargetRepository(prisma),
    cipher,
    publisherFor: (platform) => createPublisher(platform),
    google: {
      async refresh(refreshToken) {
        requireEnv("GOOGLE_CLIENT_ID");
        const t = await refreshGoogleAccessToken(googleCfg, refreshToken);
        return { accessToken: t.accessToken, expiresAt: t.expiresAt };
      },
    },
    log: (msg, meta) => console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...meta })),
  };

  const metricsRepo = prismaMetricsRepository(prisma);
  const importRepo = prismaImportRepository(prisma);
  const reconcileRepo = prismaReconcileRepository(prisma);
  const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 5);
  const worker = new Worker<AppJobData>(
    PUBLISH_QUEUE_NAME,
    async (job) => {
      if (job.name === RECONCILE_JOB_NAME) {
        return reconcileTargets({ repo: reconcileRepo, queue, log: deps.log });
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
  // Reconcilia já na subida: retoma o que ficou preso enquanto o worker esteve fora.
  await reconcileTargets({ repo: reconcileRepo, queue, log: deps.log });
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg: "worker started", queue: PUBLISH_QUEUE_NAME, concurrency, metricsScheduler: "6h" }));

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

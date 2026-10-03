import { config as loadEnv } from "dotenv";
import path from "node:path";
loadEnv({ path: path.resolve(process.cwd(), "../../.env") });
loadEnv();
import { createPublisher, refreshGoogleAccessToken } from "@fsp/connectors";
import { PUBLISH_QUEUE_NAME, TokenCipher, type PublishJobData } from "@fsp/core";
import { getPrisma } from "@fsp/db";
import { createPublishQueue, createRedisConnection, requeuePublish } from "@fsp/queue";
import { Worker } from "bullmq";
import { processTarget, type ProcessorDeps } from "./processor.js";
import { prismaTargetRepository } from "./repository.js";

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
    redirectUri: `${process.env.AUTH_URL ?? "http://localhost:3000"}/api/oauth/google/callback`,
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

  const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 5);
  const worker = new Worker<PublishJobData>(
    PUBLISH_QUEUE_NAME,
    async (job) => {
      const outcome = await processTarget(deps, job.data.postTargetId);
      if (outcome.outcome === "retry") {
        // Re-agenda com o backoff calculado. O job atual termina com sucesso.
        await requeuePublish(queue, job.data.postTargetId, new Date(Date.now() + outcome.delayMs));
      }
      return outcome;
    },
    { connection, concurrency },
  );

  worker.on("failed", (job, err) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), msg: "job failed", jobId: job?.id, error: err.message }));
  });
  worker.on("error", (err) => console.error("worker error", err.message));

  console.log(JSON.stringify({ ts: new Date().toISOString(), msg: "worker started", queue: PUBLISH_QUEUE_NAME, concurrency }));

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

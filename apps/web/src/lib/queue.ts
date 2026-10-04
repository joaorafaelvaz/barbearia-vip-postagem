import { createPublishQueue, createRedisConnection, type AppJobData } from "@fsp/queue";
import type { Queue } from "bullmq";

declare global {
  // eslint-disable-next-line no-var
  var __fspQueue: Queue<AppJobData> | undefined;
}

/** Fila singleton (sobrevive ao hot-reload do Next.js). */
export function getQueue(): Queue<AppJobData> {
  if (!globalThis.__fspQueue) {
    globalThis.__fspQueue = createPublishQueue(createRedisConnection());
  }
  return globalThis.__fspQueue;
}

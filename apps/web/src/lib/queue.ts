import { createPublishQueue, createRedisConnection } from "@fsp/queue";
import type { Queue } from "bullmq";
import type { PublishJobData } from "@fsp/core";

declare global {
  // eslint-disable-next-line no-var
  var __fspQueue: Queue<PublishJobData> | undefined;
}

/** Fila singleton (sobrevive ao hot-reload do Next.js). */
export function getQueue(): Queue<PublishJobData> {
  if (!globalThis.__fspQueue) {
    globalThis.__fspQueue = createPublishQueue(createRedisConnection());
  }
  return globalThis.__fspQueue;
}

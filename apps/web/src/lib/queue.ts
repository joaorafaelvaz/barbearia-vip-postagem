import { createNoticeQueue, createPublishQueue, createRedisConnection, type AppJobData, type WhatsappNoticeJobData } from "@fsp/queue";
import type { Queue } from "bullmq";

declare global {
  // eslint-disable-next-line no-var
  var __fspQueue: Queue<AppJobData> | undefined;
  // eslint-disable-next-line no-var
  var __fspNoticeQueue: Queue<WhatsappNoticeJobData> | undefined;
}

/** Fila singleton (sobrevive ao hot-reload do Next.js). */
export function getQueue(): Queue<AppJobData> {
  if (!globalThis.__fspQueue) {
    globalThis.__fspQueue = createPublishQueue(createRedisConnection());
  }
  return globalThis.__fspQueue;
}

/** Fila própria dos Avisos WhatsApp (`whatsapp-notices`), consumida pelo worker de concorrência 1. */
export function getNoticeQueue(): Queue<WhatsappNoticeJobData> {
  if (!globalThis.__fspNoticeQueue) {
    globalThis.__fspNoticeQueue = createNoticeQueue(createRedisConnection());
  }
  return globalThis.__fspNoticeQueue;
}

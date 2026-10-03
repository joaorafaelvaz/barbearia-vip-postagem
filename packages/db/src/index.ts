import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __fspPrisma: PrismaClient | undefined;
}

/** Singleton seguro para hot-reload do Next.js e para o worker. */
export function getPrisma(): PrismaClient {
  if (!globalThis.__fspPrisma) {
    globalThis.__fspPrisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }
  return globalThis.__fspPrisma;
}

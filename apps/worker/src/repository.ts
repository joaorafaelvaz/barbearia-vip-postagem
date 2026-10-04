import type { PrismaClient } from "@fsp/db";
import type { MediaKind, Platform } from "@fsp/core";
import type { PostMetrics } from "@fsp/connectors";
import type { TargetRecord, TargetRepository } from "./processor.js";
import type { MetricsRepository, MetricsTarget } from "./metrics.js";

/** Implementação Prisma do repositório usado pelo processador. */
export function prismaTargetRepository(prisma: PrismaClient): TargetRepository {
  return {
    async loadTarget(id): Promise<TargetRecord | null> {
      const t = await prisma.postTarget.findUnique({
        where: { id },
        include: {
          account: true,
          post: { include: { media: { include: { media: true }, orderBy: { position: "asc" } } } },
        },
      });
      if (!t) return null;
      return {
        id: t.id,
        organizationId: t.organizationId,
        status: t.status,
        attempts: t.attempts,
        scheduledAt: t.scheduledAt,
        post: {
          caption: t.post.caption,
          media: t.post.media.map((m) => ({ url: m.media.publicUrl, kind: m.media.kind as MediaKind })),
        },
        account: {
          id: t.account.id,
          organizationId: t.account.organizationId,
          platform: t.account.platform as Platform,
          externalId: t.account.externalId,
          accessTokenEnc: t.account.accessTokenEnc,
          refreshTokenEnc: t.account.refreshTokenEnc,
          tokenExpiresAt: t.account.tokenExpiresAt,
          isActive: t.account.isActive,
        },
      };
    },

    async markPublishing(id) {
      const r = await prisma.postTarget.updateMany({
        where: { id, status: { in: ["SCHEDULED", "FAILED"] } },
        data: { status: "PUBLISHING" },
      });
      return r.count === 1;
    },

    async markPublished(id, result) {
      await prisma.postTarget.update({
        where: { id },
        data: {
          status: "PUBLISHED",
          externalPostId: result.externalPostId,
          externalUrl: result.externalUrl ?? null,
          publishedAt: new Date(),
          lastError: null,
          attempts: { increment: 1 },
        },
      });
    },

    async markFailed(id, attempts, error) {
      await prisma.postTarget.update({ where: { id }, data: { status: "FAILED", attempts, lastError: error } });
    },

    async markRetry(id, attempts, error) {
      await prisma.postTarget.update({ where: { id }, data: { status: "SCHEDULED", attempts, lastError: error } });
    },

    async updateAccountToken(accountId, accessTokenEnc, expiresAt) {
      await prisma.connectedAccount.update({ where: { id: accountId }, data: { accessTokenEnc, tokenExpiresAt: expiresAt } });
    },
  };
}

/** Implementação Prisma do repositório de métricas. */
export function prismaMetricsRepository(prisma: PrismaClient): MetricsRepository {
  return {
    async listTargets({ organizationId, since, limit }): Promise<MetricsTarget[]> {
      const rows = await prisma.postTarget.findMany({
        where: {
          status: "PUBLISHED",
          externalPostId: { not: null },
          publishedAt: { gte: since },
          account: { isActive: true },
          ...(organizationId ? { organizationId } : {}),
        },
        orderBy: [{ publishedAt: "asc" }],
        take: limit,
        select: {
          id: true,
          externalPostId: true,
          account: { select: { id: true, platform: true, externalId: true, accessTokenEnc: true, refreshTokenEnc: true, tokenExpiresAt: true } },
        },
      });
      return rows.map((t) => ({
        id: t.id,
        externalPostId: t.externalPostId as string,
        account: { ...t.account, platform: t.account.platform as Platform },
      }));
    },
    async saveMetrics(postTargetId, m: PostMetrics) {
      const data = { likes: m.likes, comments: m.comments, shares: m.shares, reach: m.reach, impressions: m.impressions, saves: m.saves, clicks: m.clicks, partial: m.partial, lastError: m.note ?? null, fetchedAt: new Date() };
      await prisma.targetMetrics.upsert({ where: { postTargetId }, create: { postTargetId, ...data }, update: data });
    },
    async saveError(postTargetId, error) {
      await prisma.targetMetrics.upsert({
        where: { postTargetId },
        create: { postTargetId, partial: true, lastError: error },
        update: { partial: true, lastError: error, fetchedAt: new Date() },
      });
    },
  };
}

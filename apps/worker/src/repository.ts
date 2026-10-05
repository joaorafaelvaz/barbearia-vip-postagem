import type { PrismaClient } from "@fsp/db";
import type { MediaKind, Platform, PostFormat } from "@fsp/core";
import type { PostMetrics } from "@fsp/connectors";
import type { TargetRecord, TargetRepository } from "./processor.js";
import type { ExternalPostSummary } from "@fsp/connectors";
import type { ImportAccount, ImportRepository } from "./imports.js";
import type { MetricsRepository, MetricsTarget } from "./metrics.js";
import type { ReconcileRepository } from "./reconcile.js";

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
          format: t.post.format as PostFormat,
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
      const system: MetricsTarget[] = rows.map((t) => ({
        id: t.id,
        source: "system",
        externalPostId: t.externalPostId as string,
        account: { ...t.account, platform: t.account.platform as Platform },
      }));
      const ext = await prisma.externalPost.findMany({
        where: { publishedAt: { gte: since }, account: { isActive: true }, ...(organizationId ? { organizationId } : {}) },
        orderBy: [{ publishedAt: "asc" }],
        take: limit,
        select: {
          id: true,
          externalId: true,
          account: { select: { id: true, platform: true, externalId: true, accessTokenEnc: true, refreshTokenEnc: true, tokenExpiresAt: true } },
        },
      });
      const external: MetricsTarget[] = ext.map((e) => ({
        id: e.id,
        source: "external",
        externalPostId: e.externalId,
        account: { ...e.account, platform: e.account.platform as Platform },
      }));
      return [...system, ...external];
    },
    async saveMetrics(t, m: PostMetrics) {
      const data = { likes: m.likes, comments: m.comments, shares: m.shares, reach: m.reach, impressions: m.impressions, saves: m.saves, clicks: m.clicks, partial: m.partial, lastError: m.note ?? null };
      if (t.source === "external") {
        await prisma.externalPost.update({ where: { id: t.id }, data: { ...data, metricsFetchedAt: new Date() } });
        return;
      }
      await prisma.targetMetrics.upsert({ where: { postTargetId: t.id }, create: { postTargetId: t.id, ...data, fetchedAt: new Date() }, update: { ...data, fetchedAt: new Date() } });
    },
    async saveError(t, error) {
      if (t.source === "external") {
        await prisma.externalPost.update({ where: { id: t.id }, data: { partial: true, lastError: error, metricsFetchedAt: new Date() } });
        return;
      }
      await prisma.targetMetrics.upsert({
        where: { postTargetId: t.id },
        create: { postTargetId: t.id, partial: true, lastError: error },
        update: { partial: true, lastError: error, fetchedAt: new Date() },
      });
    },
  };
}

/** Implementação Prisma do repositório de importação. */
export function prismaImportRepository(prisma: PrismaClient): ImportRepository {
  return {
    async listAccounts(filter): Promise<ImportAccount[]> {
      const rows = await prisma.connectedAccount.findMany({
        where: { isActive: true, ...(filter.connectedAccountId ? { id: filter.connectedAccountId } : {}), ...(filter.organizationId ? { organizationId: filter.organizationId } : {}) },
        select: { id: true, organizationId: true, platform: true, externalId: true, accessTokenEnc: true, refreshTokenEnc: true, tokenExpiresAt: true },
      });
      return rows.map((a) => ({ ...a, platform: a.platform as Platform }));
    },
    async upsertPosts(account, posts: ExternalPostSummary[]) {
      let created = 0;
      for (const p of posts) {
        const where = { connectedAccountId_externalId: { connectedAccountId: account.id, externalId: p.externalId } };
        const existing = await prisma.externalPost.findUnique({ where, select: { id: true } });
        const base = { caption: p.caption, permalink: p.permalink ?? null, mediaType: p.mediaType ?? null, publishedAt: p.publishedAt, likes: p.likes, comments: p.comments, shares: p.shares };
        if (existing) await prisma.externalPost.update({ where: { id: existing.id }, data: base });
        else {
          await prisma.externalPost.create({ data: { organizationId: account.organizationId, connectedAccountId: account.id, platform: account.platform, externalId: p.externalId, ...base } });
          created++;
        }
      }
      return created;
    },
  };
}

/** Implementação Prisma do repositório de reconciliação. */
export function prismaReconcileRepository(prisma: PrismaClient): ReconcileRepository {
  return {
    async listStalePublishing(before) {
      return prisma.postTarget.findMany({ where: { status: "PUBLISHING", updatedAt: { lt: before } }, select: { id: true }, take: 500 });
    },
    async listOverdueScheduled(before) {
      return prisma.postTarget.findMany({ where: { status: "SCHEDULED", scheduledAt: { lt: before } }, select: { id: true, scheduledAt: true }, take: 500 });
    },
    async resetToScheduled(id, note) {
      await prisma.postTarget.update({ where: { id }, data: { status: "SCHEDULED", lastError: note } });
    },
  };
}

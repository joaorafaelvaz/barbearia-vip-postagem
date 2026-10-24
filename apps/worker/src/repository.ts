import type { PrismaClient } from "@fsp/db";
import type { MediaKind, NoticeRecurrence, NoticeTargets, Platform, PostFormat } from "@fsp/core";
import type { PostMetrics } from "@fsp/connectors";
import type { TargetRecord, TargetRepository } from "./processor.js";
import type { ExternalPostSummary } from "@fsp/connectors";
import type { ImportAccount, ImportRepository } from "./imports.js";
import type { MetricsRepository, MetricsTarget } from "./metrics.js";
import type { ReconcileRepository } from "./reconcile.js";
import type { CleanupRepository } from "./cleanup.js";
import type { SegmentRef, SegmentRepository, SourceMedia } from "./segments.js";
import type { NoticeRepository } from "./whatsapp-notices.js";

/** Implementação Prisma do repositório usado pelo processador. */
export function prismaTargetRepository(prisma: PrismaClient): TargetRepository {
  return {
    async loadTarget(id): Promise<TargetRecord | null> {
      const t = await prisma.postTarget.findUnique({
        where: { id },
        include: {
          account: true,
          post: { include: { media: { include: { media: true }, orderBy: { position: "asc" } }, coverMedia: true } },
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
          media: t.post.media.map((m) => ({ id: m.media.id, url: m.media.publicUrl, kind: m.media.kind as MediaKind, durationSec: m.media.durationSec, normalized: m.media.normalizedAt !== null })),
          ...(t.post.coverMedia || t.post.coverOffsetMs !== null
            ? { cover: { ...(t.post.coverMedia ? { imageUrl: t.post.coverMedia.publicUrl } : {}), ...(t.post.coverOffsetMs !== null ? { offsetMs: t.post.coverOffsetMs } : {}) } }
            : {}),
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

    async updateAccountToken(accountId, accessTokenEnc, expiresAt, refreshTokenEnc) {
      await prisma.connectedAccount.update({ where: { id: accountId }, data: { accessTokenEnc, tokenExpiresAt: expiresAt, ...(refreshTokenEnc ? { refreshTokenEnc } : {}) } });
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
    async listScheduled(createdBefore) {
      return prisma.postTarget.findMany({ where: { status: "SCHEDULED", createdAt: { lt: createdBefore } }, select: { id: true, scheduledAt: true }, orderBy: { scheduledAt: "asc" }, take: 2000 });
    },
    async resetToScheduled(id, note) {
      await prisma.postTarget.update({ where: { id }, data: { status: "SCHEDULED", lastError: note } });
    },
  };
}

/** Partes de vídeo para Stories: filhas do MediaAsset original (parentId/segmentIndex). */
export function prismaSegmentRepository(prisma: PrismaClient): SegmentRepository {
  const toRef = (m: { id: string; publicUrl: string; segmentIndex: number | null; durationSec: number | null }): SegmentRef => ({
    id: m.id,
    url: m.publicUrl,
    index: m.segmentIndex ?? 0,
    durationSec: m.durationSec ?? 0,
  });
  return {
    async loadMedia(id): Promise<SourceMedia | null> {
      const m = await prisma.mediaAsset.findUnique({ where: { id } });
      if (!m) return null;
      return { id: m.id, organizationId: m.organizationId, kind: m.kind, storageKey: m.storageKey, publicUrl: m.publicUrl, width: m.width, height: m.height, durationSec: m.durationSec, normalizedAt: m.normalizedAt, normalizeNote: m.normalizeNote };
    },
    async markNormalized(id, data) {
      await prisma.mediaAsset.update({
        where: { id },
        data: {
          normalizedAt: new Date(),
          normalizeNote: data.note,
          width: data.width,
          height: data.height,
          durationSec: data.durationSec,
          ...(data.storageKey ? { storageKey: data.storageKey } : {}),
          ...(data.publicUrl ? { publicUrl: data.publicUrl } : {}),
          ...(data.bytes !== undefined ? { bytes: data.bytes } : {}),
          ...(data.mimeType ? { mimeType: data.mimeType } : {}),
        },
      });
    },
    async listSegments(parentId) {
      const rows = await prisma.mediaAsset.findMany({ where: { parentId }, orderBy: { segmentIndex: "asc" } });
      return rows.map(toRef);
    },
    async claimSplit(id, now, staleMs) {
      const r = await prisma.mediaAsset.updateMany({
        where: { id, OR: [{ splitStartedAt: null }, { splitStartedAt: { lt: new Date(now.getTime() - staleMs) } }] },
        data: { splitStartedAt: now },
      });
      return r.count === 1;
    },
    async releaseSplit(id) {
      await prisma.mediaAsset.updateMany({ where: { id }, data: { splitStartedAt: null } });
    },
    async deleteSegments(parentId) {
      await prisma.mediaAsset.deleteMany({ where: { parentId } });
    },
    async createSegment(parent, seg) {
      const m = await prisma.mediaAsset.create({
        data: {
          organizationId: parent.organizationId,
          kind: "VIDEO",
          storageKey: seg.storageKey,
          publicUrl: seg.publicUrl,
          mimeType: "video/mp4",
          width: parent.width,
          height: parent.height,
          bytes: seg.bytes,
          durationSec: Math.round(seg.durationSec),
          parentId: parent.id,
          segmentIndex: seg.index,
        },
      });
      return toRef(m);
    },
  };
}

/** Mídias expiradas: nada pendente as referencia (mídia da postagem, capa ou parte de vídeo). */
export function prismaCleanupRepository(prisma: PrismaClient): CleanupRepository {
  const pendingStatuses: Array<"SCHEDULED" | "PUBLISHING"> = ["SCHEDULED", "PUBLISHING"];
  const pending = { status: { in: pendingStatuses } };
  const notPendingPost = { targets: { none: pending } };
  return {
    async listExpired(before, limit) {
      return prisma.mediaAsset.findMany({
        where: {
          createdAt: { lt: before },
          posts: { every: { post: notPendingPost } },
          coverOf: { every: notPendingPost },
          OR: [{ parentId: null }, { parent: { posts: { every: { post: notPendingPost } } } }],
        },
        select: { id: true, storageKey: true, kind: true },
        orderBy: { createdAt: "asc" },
        take: limit,
      });
    },
    async deleteMedia(id) {
      await prisma.mediaAsset.delete({ where: { id } });
    },
  };
}

/** Implementação Prisma do repositório de avisos WhatsApp. */
export function prismaNoticeRepository(prisma: PrismaClient): NoticeRepository {
  return {
    async loadNotice(id) {
      const n = await prisma.whatsappNotice.findUnique({ where: { id } });
      if (!n) return null;
      return { id: n.id, organizationId: n.organizationId, text: n.text, targets: n.targets as unknown as NoticeTargets, firstSendAt: n.firstSendAt, recurrence: n.recurrence as unknown as NoticeRecurrence, endAt: n.endAt, nextRunAt: n.nextRunAt, state: n.state, consecutiveFailures: n.consecutiveFailures, sendingStartedAt: n.sendingStartedAt };
    },
    async claim(id, occurrenceAt) {
      const r = await prisma.whatsappNotice.updateMany({ where: { id, state: "ativo", nextRunAt: occurrenceAt }, data: { state: "enviando", sendingStartedAt: new Date() } });
      return r.count === 1;
    },
    async listUnitChats(organizationId) {
      return prisma.unit.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, whatsappChatId: true } });
    },
    async franchisorChatId(organizationId) {
      const o = await prisma.organization.findUnique({ where: { id: organizationId }, select: { whatsappChatId: true } });
      return o?.whatsappChatId ?? null;
    },
    async sentChatIds(noticeId, occurrenceAt) {
      const rows = await prisma.whatsappDelivery.findMany({ where: { noticeId, occurrenceAt, status: "enviado" }, select: { chatId: true } });
      return new Set(rows.map((r) => r.chatId));
    },
    async recordDelivery(d) {
      const data = { organizationId: d.organizationId, status: d.status, error: d.error ?? null, targetName: d.targetName, sentAt: new Date() };
      await prisma.whatsappDelivery.upsert({
        where: { noticeId_occurrenceAt_chatId: { noticeId: d.noticeId, occurrenceAt: d.occurrenceAt, chatId: d.chatId } },
        create: { noticeId: d.noticeId, occurrenceAt: d.occurrenceAt, chatId: d.chatId, ...data },
        update: data,
      });
    },
    async finishCycle(id, patch) {
      const r = await prisma.whatsappNotice.updateMany({ where: { id, state: "enviando" }, data: { ...patch, sendingStartedAt: null } });
      return r.count === 1;
    },
    async listStaleSending(before) {
      return prisma.whatsappNotice.findMany({
        where: { state: "enviando", OR: [{ sendingStartedAt: null }, { sendingStartedAt: { lt: before } }] },
        select: { id: true, nextRunAt: true, consecutiveFailures: true },
        take: 500,
      });
    },
    async touchSending(id) {
      await prisma.whatsappNotice.updateMany({ where: { id, state: "enviando" }, data: { sendingStartedAt: new Date() } });
    },
    async releaseStale(id, before) {
      // Repete a condição do heartbeat: se o ciclo renovou sendingStartedAt entre listar e soltar, não libera.
      const r = await prisma.whatsappNotice.updateMany({
        where: { id, state: "enviando", OR: [{ sendingStartedAt: null }, { sendingStartedAt: { lt: before } }] },
        data: { state: "ativo", sendingStartedAt: null },
      });
      return r.count === 1;
    },
    async listActive(updatedBefore) {
      const rows = await prisma.whatsappNotice.findMany({ where: { state: "ativo", nextRunAt: { not: null }, updatedAt: { lt: updatedBefore } }, select: { id: true, nextRunAt: true, consecutiveFailures: true }, orderBy: { nextRunAt: "asc" }, take: 2000 });
      return rows.map((r) => ({ id: r.id, nextRunAt: r.nextRunAt as Date, consecutiveFailures: r.consecutiveFailures }));
    },
  };
}

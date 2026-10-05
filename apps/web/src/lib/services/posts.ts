import { localToUtc, validateCaption, validateFormat, validateMediaSet, type MediaKind, type Platform, type PostFormat } from "@fsp/core";
import { enqueuePublish, requeuePublish, dequeuePublish, type PublishQueueLike } from "@fsp/queue";
import type { PrismaClient } from "@fsp/db";
import { z } from "zod";
import { HttpError } from "../api";

export const createPostSchema = z.object({
  format: z.enum(["FEED", "STORY", "REEL"]).default("FEED"),
  caption: z.string().max(70_000),
  /** `YYYY-MM-DDTHH:mm` no fuso de cada unidade */
  scheduledLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  mediaIds: z.array(z.string().min(1)).max(10).default([]),
  /** Contas conectadas selecionadas (uma por unidade × plataforma) */
  accountIds: z.array(z.string().min(1)).min(1, "Selecione pelo menos uma conta"),
});
export type CreatePostInput = z.infer<typeof createPostSchema>;

interface AccountRow {
  id: string;
  platform: Platform;
  isActive: boolean;
  unit: { id: string; name: string; timezone: string };
}

/**
 * Regra pura: valida texto/mídia por plataforma e calcula `scheduledAt` (UTC) por conta,
 * usando o fuso da unidade de cada conta. Separada para ser testável sem banco.
 */
export function buildTargets(
  input: Pick<CreatePostInput, "caption" | "scheduledLocal"> & { format?: PostFormat },
  accounts: readonly AccountRow[],
  mediaKinds: readonly MediaKind[],
  now: Date = new Date(),
): Array<{ connectedAccountId: string; scheduledAt: Date }> {
  const platforms = [...new Set(accounts.map((a) => a.platform))];
  const format = input.format ?? "FEED";
  const issues = [
    ...validateCaption(input.caption, platforms, mediaKinds.length > 0),
    ...(format === "FEED" ? validateMediaSet(mediaKinds, platforms) : []),
    ...validateFormat(format, platforms, mediaKinds),
  ];
  if (issues.length > 0) {
    throw new HttpError(400, issues.map((i) => i.message).join(" "), issues);
  }
  const targets = accounts.map((a) => ({
    connectedAccountId: a.id,
    scheduledAt: localToUtc(input.scheduledLocal, a.unit.timezone),
  }));
  const earliest = Math.min(...targets.map((t) => t.scheduledAt.getTime()));
  if (earliest < now.getTime() - 60_000) {
    throw new HttpError(400, "O horário escolhido já passou em pelo menos uma unidade.");
  }
  return targets;
}

export async function createPost(
  deps: { prisma: PrismaClient; queue: PublishQueueLike },
  organizationId: string,
  userId: string,
  raw: unknown,
  allowedUnitIds: string[] | null = null,
) {
  const input = createPostSchema.parse(raw);
  const accounts = await deps.prisma.connectedAccount.findMany({
    where: { id: { in: input.accountIds }, organizationId, ...(allowedUnitIds ? { unitId: { in: allowedUnitIds } } : {}) },
    select: { id: true, platform: true, isActive: true, unit: { select: { id: true, name: true, timezone: true } } },
  });
  if (accounts.length !== input.accountIds.length) {
    throw new HttpError(403, "Uma ou mais contas selecionadas não pertencem às suas unidades.");
  }
  const inactive = accounts.filter((a) => !a.isActive);
  if (inactive.length > 0) throw new HttpError(400, "Há contas desconectadas entre as selecionadas.");

  const media = await deps.prisma.mediaAsset.findMany({
    where: { id: { in: input.mediaIds }, organizationId },
    select: { id: true, kind: true },
  });
  if (media.length !== input.mediaIds.length) throw new HttpError(400, "Mídia inválida.");
  const kindById = new Map(media.map((m) => [m.id, m.kind as MediaKind]));
  const mediaKinds = input.mediaIds.map((id) => kindById.get(id) ?? "IMAGE");

  const targets = buildTargets(input, accounts as AccountRow[], mediaKinds);

  const post = await deps.prisma.$transaction(async (tx) => {
    const created = await tx.post.create({
      data: {
        organizationId,
        format: input.format,
        caption: input.caption,
        scheduledLocal: input.scheduledLocal,
        createdById: userId,
        media: { create: input.mediaIds.map((mediaId, position) => ({ mediaId, position })) },
        targets: { create: targets.map((t) => ({ ...t, organizationId })) },
      },
      include: { targets: true },
    });
    return created;
  });

  // Enfileira fora da transação: se falhar, o painel mostra SCHEDULED e "re-tentar" recupera.
  await Promise.all(post.targets.map((t) => enqueuePublish(deps.queue, t.id, t.scheduledAt)));
  return post;
}

function targetWhere(organizationId: string, targetId: string, allowed: string[] | null) {
  return { id: targetId, organizationId, ...(allowed ? { account: { unitId: { in: allowed } } } : {}) };
}

export async function retryTarget(deps: { prisma: PrismaClient; queue: PublishQueueLike }, organizationId: string, targetId: string, allowed: string[] | null = null) {
  const target = await deps.prisma.postTarget.findFirst({ where: targetWhere(organizationId, targetId, allowed) });
  if (!target) throw new HttpError(404, "Publicação não encontrada.");
  if (target.status === "PUBLISHED") throw new HttpError(409, "Já publicado.");
  await deps.prisma.postTarget.update({ where: { id: targetId }, data: { status: "SCHEDULED", lastError: null } });
  await requeuePublish(deps.queue, targetId, new Date());
}

export async function cancelTarget(deps: { prisma: PrismaClient; queue: PublishQueueLike }, organizationId: string, targetId: string, allowed: string[] | null = null) {
  const target = await deps.prisma.postTarget.findFirst({ where: targetWhere(organizationId, targetId, allowed) });
  if (!target) throw new HttpError(404, "Publicação não encontrada.");
  if (target.status !== "SCHEDULED" && target.status !== "FAILED") {
    throw new HttpError(409, `Não é possível cancelar com status ${target.status}.`);
  }
  await dequeuePublish(deps.queue, targetId);
  await deps.prisma.postTarget.update({ where: { id: targetId }, data: { status: "CANCELLED" } });
}

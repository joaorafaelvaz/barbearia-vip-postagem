import type { PrismaClient } from "@fsp/db";
import { dequeuePublish, type PublishQueueLike } from "@fsp/queue";
import { HttpError } from "../api";

/** Resumo do que será afetado ao remover uma unidade (para a confirmação na UI). */
export async function unitRemovalSummary(prisma: PrismaClient, organizationId: string, unitId: string) {
  const unit = await prisma.unit.findFirst({ where: { id: unitId, organizationId }, select: { id: true, name: true } });
  if (!unit) throw new HttpError(404, "Unidade não encontrada.");
  const [accounts, scheduled, published] = await Promise.all([
    prisma.connectedAccount.count({ where: { unitId } }),
    prisma.postTarget.count({ where: { account: { unitId }, status: { in: ["SCHEDULED", "PUBLISHING"] } } }),
    prisma.postTarget.count({ where: { account: { unitId }, status: "PUBLISHED" } }),
  ]);
  return { unit, accounts, scheduled, published };
}

/**
 * Remove a unidade. Jobs pendentes saem da fila antes; contas, delegações e histórico
 * de publicações da unidade são apagados em cascata pelo banco. Posts (conteúdo) ficam.
 */
export async function deleteUnit(deps: { prisma: PrismaClient; queue: PublishQueueLike }, organizationId: string, unitId: string) {
  const summary = await unitRemovalSummary(deps.prisma, organizationId, unitId);
  const pending = await deps.prisma.postTarget.findMany({
    where: { account: { unitId }, status: { in: ["SCHEDULED", "FAILED"] } },
    select: { id: true },
  });
  await Promise.all(pending.map((t) => dequeuePublish(deps.queue, t.id).catch(() => false)));
  await deps.prisma.unit.delete({ where: { id: unitId } });
  return summary;
}

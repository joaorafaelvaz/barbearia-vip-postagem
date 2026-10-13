import { InstagramProfileClient } from "@fsp/connectors";
import type { PrismaClient } from "@fsp/db";
import { HttpError } from "../api";
import { assertUnitAllowed } from "../authz";
import { getCipher } from "../crypto";
import type { SessionUser } from "../session";

/** Conta Instagram que o usuário pode gerenciar, com o token em claro para as chamadas. */
export async function loadInstagramAccount(prisma: PrismaClient, s: SessionUser, accountId: string) {
  const account = await prisma.connectedAccount.findFirst({
    where: { id: accountId, organizationId: s.organizationId },
    include: { unit: { select: { id: true, name: true } } },
  });
  if (!account) throw new HttpError(404, "Conta não encontrada.");
  if (account.platform !== "INSTAGRAM") throw new HttpError(400, "Gestão de perfil disponível só para Instagram por enquanto.");
  await assertUnitAllowed(prisma, s, account.unitId);
  if (!account.isActive) throw new HttpError(409, "Conta desconectada. Reconecte em Unidades e contas.");
  const cipher = getCipher();
  return {
    account,
    token: cipher.decrypt(account.accessTokenEnc),
    /** Token de usuário Meta; ausente em contas conectadas antes desta versão. */
    userToken: account.userTokenEnc ? cipher.decrypt(account.userTokenEnc) : null,
    client: new InstagramProfileClient(),
  };
}

/**
 * Registra no sistema que uma mídia foi excluída na plataforma: o alvo publicado vira
 * CANCELLED com nota e a cópia importada some do analytics.
 */
export async function noteMediaDeleted(prisma: PrismaClient, organizationId: string, accountId: string, mediaId: string): Promise<void> {
  await prisma.postTarget.updateMany({
    where: { organizationId, connectedAccountId: accountId, externalPostId: mediaId, status: "PUBLISHED" },
    data: { status: "CANCELLED", lastError: "[DELETED] Excluída no Instagram pelo painel." },
  });
  await prisma.externalPost.deleteMany({ where: { organizationId, connectedAccountId: accountId, externalId: mediaId } });
}

export const PROFILE_SUPPORTED = new Set(["INSTAGRAM"]);

import { NextResponse } from "next/server";
import { HttpError, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { loadInstagramAccount, noteMediaDeleted } from "@/lib/services/profiles";
import { requireSession } from "@/lib/session";

/** Exclui a mídia no Instagram e registra no sistema. */
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ accountId: string; mediaId: string }> }) => {
  const s = await requireSession();
  const { accountId, mediaId } = await ctx.params;
  const { account, token, userToken, client } = await loadInstagramAccount(prisma, s, accountId);
  // A Meta exige token de usuário (não de Página) para excluir mídia. Sem ele, a conta precisa ser reconectada.
  if (!userToken) throw new HttpError(409, "Reconecte esta conta em Unidades e contas: a exclusão exige uma autorização nova da Meta.");
  await client.deleteMedia(mediaId, userToken);
  await noteMediaDeleted(prisma, s.organizationId, account.id, mediaId);
  return NextResponse.json({ ok: true });
});

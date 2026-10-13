import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { loadInstagramAccount, noteMediaDeleted } from "@/lib/services/profiles";
import { requireSession } from "@/lib/session";

/** Exclui a mídia no Instagram e registra no sistema. */
export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ accountId: string; mediaId: string }> }) => {
  const s = await requireSession();
  const { accountId, mediaId } = await ctx.params;
  const { account, token, client } = await loadInstagramAccount(prisma, s, accountId);
  await client.deleteMedia(mediaId, token);
  await noteMediaDeleted(prisma, s.organizationId, account.id, mediaId);
  return NextResponse.json({ ok: true });
});

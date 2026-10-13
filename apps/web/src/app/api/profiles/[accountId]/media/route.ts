import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { loadInstagramAccount } from "@/lib/services/profiles";
import { requireSession } from "@/lib/session";

/** Página de mídias do perfil (?after=cursor). */
export const GET = route(async (req: Request, ctx: { params: Promise<{ accountId: string }> }) => {
  const s = await requireSession();
  const { accountId } = await ctx.params;
  const after = new URL(req.url).searchParams.get("after") ?? undefined;
  const { account, token, client } = await loadInstagramAccount(prisma, s, accountId);
  return NextResponse.json(await client.listMedia(account.externalId, token, after));
});

import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { loadInstagramAccount } from "@/lib/services/profiles";
import { requireSession } from "@/lib/session";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ accountId: string; mediaId: string }> }) => {
  const s = await requireSession();
  const { accountId, mediaId } = await ctx.params;
  const { token, client } = await loadInstagramAccount(prisma, s, accountId);
  return NextResponse.json({ comments: await client.listComments(mediaId, token) });
});

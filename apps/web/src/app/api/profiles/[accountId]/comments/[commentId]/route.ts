import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { loadInstagramAccount } from "@/lib/services/profiles";
import { requireSession } from "@/lib/session";

type Ctx = { params: Promise<{ accountId: string; commentId: string }> };

/** Responde ao comentário. */
export const POST = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession();
  const { accountId, commentId } = await ctx.params;
  const { message } = z.object({ message: z.string().trim().min(1, "Escreva a resposta.").max(2200) }).parse(await req.json());
  const { token, client } = await loadInstagramAccount(prisma, s, accountId);
  return NextResponse.json(await client.replyToComment(commentId, token, message), { status: 201 });
});

/** Oculta ou mostra o comentário. */
export const PATCH = route(async (req: Request, ctx: Ctx) => {
  const s = await requireSession();
  const { accountId, commentId } = await ctx.params;
  const { hidden } = z.object({ hidden: z.boolean() }).parse(await req.json());
  const { token, client } = await loadInstagramAccount(prisma, s, accountId);
  await client.setCommentHidden(commentId, token, hidden);
  return NextResponse.json({ ok: true });
});

export const DELETE = route(async (_req: Request, ctx: Ctx) => {
  const s = await requireSession();
  const { accountId, commentId } = await ctx.params;
  const { token, client } = await loadInstagramAccount(prisma, s, accountId);
  await client.deleteComment(commentId, token);
  return NextResponse.json({ ok: true });
});

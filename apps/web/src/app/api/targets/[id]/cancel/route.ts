import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getQueue } from "@/lib/queue";
import { cancelTarget } from "@/lib/services/posts";
import { requireSession } from "@/lib/session";

export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireSession();
  const { id } = await ctx.params;
  await cancelTarget({ prisma, queue: getQueue() }, s.organizationId, id);
  return NextResponse.json({ ok: true });
});

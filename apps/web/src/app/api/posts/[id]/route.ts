import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { allowedUnitIds } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getQueue } from "@/lib/queue";
import { deletePost } from "@/lib/services/posts";
import { requireSession } from "@/lib/session";

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireSession();
  const { id } = await ctx.params;
  const removed = await deletePost({ prisma, queue: getQueue() }, s.organizationId, await allowedUnitIds(prisma, s), id);
  return NextResponse.json({ ok: true, removed });
});

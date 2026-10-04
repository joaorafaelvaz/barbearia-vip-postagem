import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getQueue } from "@/lib/queue";
import { deleteUnit, unitRemovalSummary } from "@/lib/services/units";
import { requireSession } from "@/lib/session";

/** Resumo para a confirmação de remoção. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireSession();
  requireAdmin(s);
  const { id } = await ctx.params;
  return NextResponse.json(await unitRemovalSummary(prisma, s.organizationId, id));
});

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireSession();
  requireAdmin(s);
  const { id } = await ctx.params;
  const removed = await deleteUnit({ prisma, queue: getQueue() }, s.organizationId, id);
  return NextResponse.json({ ok: true, removed });
});

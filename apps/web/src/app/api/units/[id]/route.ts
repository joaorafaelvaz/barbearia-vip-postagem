import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getQueue } from "@/lib/queue";
import { deleteUnit, unitRemovalSummary } from "@/lib/services/units";
import { chatIdSchema } from "@/lib/services/whatsapp-notices";
import { requireSession } from "@/lib/session";

const patchSchema = z.object({ whatsappChatId: chatIdSchema });

/** Grupo WhatsApp da unidade (Avisos WhatsApp). */
export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireSession();
  requireAdmin(s);
  const { id } = await ctx.params;
  const input = patchSchema.parse(await req.json());
  const r = await prisma.unit.updateMany({ where: { id, organizationId: s.organizationId }, data: { whatsappChatId: input.whatsappChatId || null } });
  if (r.count === 0) throw new HttpError(404, "Unidade não encontrada.");
  return NextResponse.json({ ok: true });
});

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

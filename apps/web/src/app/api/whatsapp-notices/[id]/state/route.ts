import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getNoticeQueue } from "@/lib/queue";
import { changeNoticeState } from "@/lib/services/whatsapp-notices";
import { requireSession } from "@/lib/session";

const schema = z.object({ state: z.enum(["ativo", "pausado", "cancelado"]) });

/** Pausar / retomar / cancelar (lista branca de transições; fora dela -> 409). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireSession();
  requireAdmin(s);
  const { id } = await ctx.params;
  const { state } = schema.parse(await req.json());
  await changeNoticeState({ prisma, queue: getNoticeQueue() }, s.organizationId, id, state);
  return NextResponse.json({ ok: true });
});

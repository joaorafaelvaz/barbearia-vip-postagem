import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getNoticeQueue } from "@/lib/queue";
import { updateNotice } from "@/lib/services/whatsapp-notices";
import { requireSession } from "@/lib/session";

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireSession();
  requireAdmin(s);
  const { id } = await ctx.params;
  const notice = await updateNotice({ prisma, queue: getNoticeQueue() }, s.organizationId, id, await req.json());
  return NextResponse.json({ notice });
});

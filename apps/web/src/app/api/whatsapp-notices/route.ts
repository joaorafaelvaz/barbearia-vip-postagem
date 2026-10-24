import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getNoticeQueue } from "@/lib/queue";
import { createNotice, listDeliveries, listNotices } from "@/lib/services/whatsapp-notices";
import { requireSession } from "@/lib/session";

export const GET = route(async () => {
  const s = await requireSession();
  requireAdmin(s);
  const [notices, deliveries] = await Promise.all([listNotices(prisma, s.organizationId), listDeliveries(prisma, s.organizationId)]);
  return NextResponse.json({ notices, deliveries });
});

export const POST = route(async (req: Request) => {
  const s = await requireSession();
  requireAdmin(s);
  const notice = await createNotice({ prisma, queue: getNoticeQueue() }, s.organizationId, s.userId, await req.json());
  return NextResponse.json({ notice }, { status: 201 });
});

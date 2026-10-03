import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getQueue } from "@/lib/queue";
import { createPost } from "@/lib/services/posts";
import { requireSession } from "@/lib/session";

export const GET = route(async (req: Request) => {
  const s = await requireSession();
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const targets = await prisma.postTarget.findMany({
    where: {
      organizationId: s.organizationId,
      ...(from || to
        ? { scheduledAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    orderBy: { scheduledAt: "asc" },
    include: {
      post: { select: { id: true, caption: true, scheduledLocal: true } },
      account: { select: { platform: true, displayName: true, unit: { select: { id: true, name: true } } } },
    },
    take: 500,
  });
  return NextResponse.json({ targets });
});

export const POST = route(async (req: Request) => {
  const s = await requireSession();
  const post = await createPost({ prisma, queue: getQueue() }, s.organizationId, s.userId, await req.json());
  return NextResponse.json({ post }, { status: 201 });
});

import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { disconnectAccount } from "@/lib/services/accounts";
import { requireSession } from "@/lib/session";

export const DELETE = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireSession();
  const { id } = await ctx.params;
  await disconnectAccount(prisma, s.organizationId, id);
  return NextResponse.json({ ok: true });
});

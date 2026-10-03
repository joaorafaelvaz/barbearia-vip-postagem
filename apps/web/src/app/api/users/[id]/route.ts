import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { updateUser } from "@/lib/services/users";
import { requireSession } from "@/lib/session";

export const PATCH = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = await requireSession();
  requireAdmin(s);
  const { id } = await ctx.params;
  const user = await updateUser(prisma, s.organizationId, s.userId, id, await req.json());
  return NextResponse.json({ user });
});

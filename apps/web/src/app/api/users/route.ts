import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { createUser, listUsers } from "@/lib/services/users";
import { requireSession } from "@/lib/session";

export const GET = route(async () => {
  const s = await requireSession();
  requireAdmin(s);
  return NextResponse.json({ users: await listUsers(prisma, s.organizationId) });
});

export const POST = route(async (req: Request) => {
  const s = await requireSession();
  requireAdmin(s);
  const user = await createUser(prisma, s.organizationId, await req.json());
  return NextResponse.json({ user }, { status: 201 });
});

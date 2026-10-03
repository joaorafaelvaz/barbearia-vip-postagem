import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { changeOwnPassword } from "@/lib/services/users";
import { requireSession } from "@/lib/session";

export const POST = route(async (req: Request) => {
  const s = await requireSession();
  await changeOwnPassword(prisma, s.userId, await req.json());
  return NextResponse.json({ ok: true });
});

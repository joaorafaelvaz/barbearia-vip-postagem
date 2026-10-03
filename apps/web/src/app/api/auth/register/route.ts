import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { register } from "@/lib/services/auth";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/session";

export const POST = route(async (req: Request) => {
  const user = await register(prisma, await req.json());
  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, await signSession(user), sessionCookieOptions());
  return res;
});

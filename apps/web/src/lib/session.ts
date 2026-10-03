import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { env } from "./env";

export const SESSION_COOKIE = "fsp_session";
const SESSION_TTL_SECONDS = 7 * 24 * 3600;

export interface SessionUser {
  userId: string;
  organizationId: string;
  email: string;
  name: string | null;
  role: "OWNER" | "MANAGER";
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env("AUTH_SECRET"));
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.organizationId !== "string" || typeof payload.userId !== "string") return null;
    return {
      userId: payload.userId,
      organizationId: payload.organizationId,
      email: String(payload.email),
      name: (payload.name as string | null) ?? null,
      role: payload.role === "OWNER" ? "OWNER" : "MANAGER",
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/** Para rotas e páginas protegidas. Lança um erro tipado quando não autenticado. */
export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new UnauthorizedError();
  return s;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Não autenticado");
    this.name = "UnauthorizedError";
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

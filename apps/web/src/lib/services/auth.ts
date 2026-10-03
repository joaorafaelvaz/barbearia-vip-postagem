import type { PrismaClient } from "@fsp/db";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { HttpError } from "../api";
import type { SessionUser } from "../session";

export const registerSchema = z.object({
  organizationName: z.string().min(2).max(120),
  name: z.string().min(2).max(120),
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(200),
});

export const loginSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(1),
});

/** Cria a organização (franqueador) e o usuário OWNER. */
export async function register(prisma: PrismaClient, raw: unknown): Promise<SessionUser> {
  const input = registerSchema.parse(raw);
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new HttpError(409, "Já existe uma conta com este e-mail.");
  const passwordHash = await bcrypt.hash(input.password, 12);
  const org = await prisma.organization.create({
    data: {
      name: input.organizationName,
      users: { create: { email: input.email, name: input.name, passwordHash, role: "OWNER" } },
    },
    include: { users: true },
  });
  const user = org.users[0]!;
  return { userId: user.id, organizationId: org.id, email: user.email, name: user.name, role: "OWNER" };
}

export async function login(prisma: PrismaClient, raw: unknown): Promise<SessionUser> {
  const input = loginSchema.parse(raw);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const ok = user?.passwordHash ? await bcrypt.compare(input.password, user.passwordHash) : false;
  if (!user || !ok) throw new HttpError(401, "E-mail ou senha inválidos.");
  return { userId: user.id, organizationId: user.organizationId, email: user.email, name: user.name, role: user.role };
}

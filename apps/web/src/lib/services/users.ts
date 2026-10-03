import type { PrismaClient } from "@fsp/db";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { HttpError } from "../api";

export const createUserSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(200),
  role: z.enum(["OWNER", "MANAGER"]).default("MANAGER"),
  unitIds: z.array(z.string().min(1)).default([]),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  role: z.enum(["OWNER", "MANAGER"]).optional(),
  unitIds: z.array(z.string().min(1)).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(200).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export async function listUsers(prisma: PrismaClient, organizationId: string) {
  return prisma.user.findMany({
    where: { organizationId },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, email: true, role: true, isActive: true, createdAt: true,
      units: { select: { unitId: true } },
    },
  });
}

async function assertUnitsInOrg(prisma: PrismaClient, organizationId: string, unitIds: string[]) {
  if (unitIds.length === 0) return;
  const count = await prisma.unit.count({ where: { id: { in: unitIds }, organizationId } });
  if (count !== unitIds.length) throw new HttpError(400, "Uma ou mais unidades não pertencem à sua rede.");
}

export async function createUser(prisma: PrismaClient, organizationId: string, raw: unknown) {
  const input = createUserSchema.parse(raw);
  if (await prisma.user.findUnique({ where: { email: input.email } })) {
    throw new HttpError(409, "Já existe um usuário com este e-mail.");
  }
  await assertUnitsInOrg(prisma, organizationId, input.unitIds);
  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.user.create({
    data: {
      organizationId, name: input.name, email: input.email, passwordHash, role: input.role,
      units: { create: input.unitIds.map((unitId) => ({ unitId })) },
    },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
}

export async function updateUser(prisma: PrismaClient, organizationId: string, actorId: string, userId: string, raw: unknown) {
  const input = updateUserSchema.parse(raw);
  const user = await prisma.user.findFirst({ where: { id: userId, organizationId } });
  if (!user) throw new HttpError(404, "Usuário não encontrado.");
  if (userId === actorId && (input.role === "MANAGER" || input.isActive === false)) {
    throw new HttpError(400, "Você não pode rebaixar ou desativar a si mesmo.");
  }
  if (input.unitIds) await assertUnitsInOrg(prisma, organizationId, input.unitIds);
  const passwordHash = input.password ? await bcrypt.hash(input.password, 12) : undefined;
  return prisma.$transaction(async (tx) => {
    if (input.unitIds) {
      await tx.userUnit.deleteMany({ where: { userId } });
      if (input.unitIds.length > 0) await tx.userUnit.createMany({ data: input.unitIds.map((unitId) => ({ userId, unitId })) });
    }
    return tx.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(passwordHash ? { passwordHash } : {}),
      },
      select: { id: true, name: true, email: true, role: true, isActive: true, units: { select: { unitId: true } } },
    });
  });
}

export async function changeOwnPassword(prisma: PrismaClient, userId: string, raw: unknown) {
  const input = changePasswordSchema.parse(raw);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const ok = user.passwordHash ? await bcrypt.compare(input.currentPassword, user.passwordHash) : false;
  if (!ok) throw new HttpError(400, "Senha atual incorreta.");
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(input.newPassword, 12) } });
}

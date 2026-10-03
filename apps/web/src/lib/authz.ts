import type { PrismaClient } from "@fsp/db";
import { HttpError } from "./api";
import type { SessionUser } from "./session";

export const ROLE_LABELS: Record<SessionUser["role"], string> = {
  OWNER: "Administrador",
  MANAGER: "Gestor",
};

export function isAdmin(s: SessionUser): boolean {
  return s.role === "OWNER";
}

/** Lança 403 quando o usuário não é administrador. */
export function requireAdmin(s: SessionUser): void {
  if (!isAdmin(s)) throw new HttpError(403, "Apenas administradores podem fazer isso.");
}

/**
 * Unidades que o usuário pode ver e usar. `null` = todas (administrador).
 * Gestores só enxergam as unidades delegadas pelo administrador.
 */
export async function allowedUnitIds(prisma: PrismaClient, s: SessionUser): Promise<string[] | null> {
  if (isAdmin(s)) return null;
  const rows = await prisma.userUnit.findMany({
    where: { userId: s.userId, unit: { organizationId: s.organizationId } },
    select: { unitId: true },
  });
  return rows.map((r) => r.unitId);
}

/** Filtro Prisma para `unitId` conforme a delegação. */
export function unitFilter(allowed: string[] | null): { unitId?: { in: string[] } } {
  return allowed === null ? {} : { unitId: { in: allowed } };
}

export function canUseUnit(allowed: string[] | null, unitId: string): boolean {
  return allowed === null || allowed.includes(unitId);
}

export async function assertUnitAllowed(prisma: PrismaClient, s: SessionUser, unitId: string): Promise<void> {
  const unit = await prisma.unit.findFirst({ where: { id: unitId, organizationId: s.organizationId }, select: { id: true } });
  if (!unit) throw new HttpError(404, "Unidade não encontrada.");
  const allowed = await allowedUnitIds(prisma, s);
  if (!canUseUnit(allowed, unitId)) throw new HttpError(403, "Você não tem acesso a esta unidade.");
}

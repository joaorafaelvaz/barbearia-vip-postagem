import type { MetaPage, GoogleLocation } from "@fsp/connectors";
import type { TokenCipher } from "@fsp/core";
import type { PrismaClient } from "@fsp/db";
import { HttpError } from "../api";

interface Deps {
  prisma: PrismaClient;
  cipher: Pick<TokenCipher, "encrypt" | "decrypt">;
}

async function assertUnit(prisma: PrismaClient, organizationId: string, unitId: string) {
  const unit = await prisma.unit.findFirst({ where: { id: unitId, organizationId } });
  if (!unit) throw new HttpError(404, "Unidade não encontrada.");
  return unit;
}

/**
 * Vincula Pages (e seus Instagram Business Accounts) a uma unidade.
 * Page tokens derivados de user token de longa duração não expiram.
 */
export async function connectMetaPages(deps: Deps, organizationId: string, unitId: string, pages: MetaPage[]) {
  await assertUnit(deps.prisma, organizationId, unitId);
  for (const page of pages) {
    const tokenEnc = deps.cipher.encrypt(page.accessToken);
    await deps.prisma.connectedAccount.upsert({
      where: { organizationId_platform_externalId: { organizationId, platform: "FACEBOOK_PAGE", externalId: page.id } },
      create: { organizationId, unitId, platform: "FACEBOOK_PAGE", externalId: page.id, displayName: page.name, accessTokenEnc: tokenEnc },
      update: { unitId, displayName: page.name, accessTokenEnc: tokenEnc, isActive: true },
    });
    const ig = page.instagramBusinessAccount;
    if (ig) {
      const name = ig.username ? `@${ig.username}` : `Instagram de ${page.name}`;
      await deps.prisma.connectedAccount.upsert({
        where: { organizationId_platform_externalId: { organizationId, platform: "INSTAGRAM", externalId: ig.id } },
        create: {
          organizationId,
          unitId,
          platform: "INSTAGRAM",
          externalId: ig.id,
          displayName: name,
          accessTokenEnc: tokenEnc,
          parentExternalId: page.id,
        },
        update: { unitId, displayName: name, accessTokenEnc: tokenEnc, parentExternalId: page.id, isActive: true },
      });
    }
  }
}

/** Vincula locations do Google Business Profile a uma unidade, guardando refresh token. */
export async function connectGoogleLocations(
  deps: Deps,
  organizationId: string,
  unitId: string,
  locations: GoogleLocation[],
  tokens: { accessToken: string; refreshToken: string; expiresAt: Date },
) {
  await assertUnit(deps.prisma, organizationId, unitId);
  const accessEnc = deps.cipher.encrypt(tokens.accessToken);
  const refreshEnc = deps.cipher.encrypt(tokens.refreshToken);
  for (const loc of locations) {
    const displayName = loc.address ? `${loc.title} (${loc.address})` : loc.title;
    await deps.prisma.connectedAccount.upsert({
      where: { organizationId_platform_externalId: { organizationId, platform: "GOOGLE_BUSINESS_PROFILE", externalId: loc.name } },
      create: {
        organizationId,
        unitId,
        platform: "GOOGLE_BUSINESS_PROFILE",
        externalId: loc.name,
        displayName,
        accessTokenEnc: accessEnc,
        refreshTokenEnc: refreshEnc,
        tokenExpiresAt: tokens.expiresAt,
      },
      update: { unitId, displayName, accessTokenEnc: accessEnc, refreshTokenEnc: refreshEnc, tokenExpiresAt: tokens.expiresAt, isActive: true },
    });
  }
}

export async function disconnectAccount(prisma: PrismaClient, organizationId: string, accountId: string, allowedUnitIds: string[] | null = null) {
  const r = await prisma.connectedAccount.updateMany({
    where: { id: accountId, organizationId, ...(allowedUnitIds ? { unitId: { in: allowedUnitIds } } : {}) },
    data: { isActive: false },
  });
  if (r.count === 0) throw new HttpError(404, "Conta não encontrada.");
}

/** Unidades com suas contas ativas. `allowedUnitIds` null = todas (administrador). */
export async function listUnitsWithAccounts(prisma: PrismaClient, organizationId: string, allowedUnitIds: string[] | null = null) {
  return prisma.unit.findMany({
    where: { organizationId, ...(allowedUnitIds ? { id: { in: allowedUnitIds } } : {}) },
    orderBy: { name: "asc" },
    include: {
      accounts: {
        where: { isActive: true },
        orderBy: { platform: "asc" },
        select: { id: true, platform: true, displayName: true, externalId: true, tokenExpiresAt: true },
      },
    },
  });
}

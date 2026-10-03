import { TokenCipher } from "@fsp/core";
import { PrismaClient } from "@fsp/db";
import { config as loadEnv } from "dotenv";
import path from "node:path";

loadEnv({ path: path.resolve(process.cwd(), "../../.env") });

export const prisma = new PrismaClient();

export function uniqueEmail(prefix = "e2e"): string {
  return `${prefix}+${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`;
}

/** Cria unidade + contas falsas (tokens cifrados) para testar composição sem OAuth real. */
export async function seedUnitWithAccounts(email: string, unitName: string, timezone = "America/Sao_Paulo") {
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const cipher = TokenCipher.fromEnv();
  const unit = await prisma.unit.create({ data: { organizationId: user.organizationId, name: unitName, timezone } });
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  await prisma.connectedAccount.createMany({
    data: [
      { organizationId: user.organizationId, unitId: unit.id, platform: "FACEBOOK_PAGE", externalId: `fb-${suffix}`, displayName: `Page ${unitName}`, accessTokenEnc: cipher.encrypt("fake") },
      { organizationId: user.organizationId, unitId: unit.id, platform: "INSTAGRAM", externalId: `ig-${suffix}`, displayName: `@${unitName.toLowerCase()}`, accessTokenEnc: cipher.encrypt("fake") },
      { organizationId: user.organizationId, unitId: unit.id, platform: "GOOGLE_BUSINESS_PROFILE", externalId: `accounts/1/locations/${suffix}`, displayName: `GBP ${unitName}`, accessTokenEnc: cipher.encrypt("fake"), refreshTokenEnc: cipher.encrypt("fake-refresh"), tokenExpiresAt: new Date(Date.now() + 3600_000) },
    ],
  });
  return unit;
}

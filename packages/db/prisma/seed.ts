/**
 * Seed de desenvolvimento: cria uma rede com 3 unidades e contas FALSAS
 * (tokens cifrados sem valor real) para navegar na UI sem OAuth.
 * Logins: dono@rede.local / senha12345 (administrador)
 *         gestor@rede.local / senha12345 (gestor, só Unidade Manaus)
 */
import { TokenCipher } from "@fsp/core";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const cipher = TokenCipher.fromEnv();
  const email = "dono@rede.local";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await ensureManager(existing.organizationId);
    console.log("Seed já aplicado; gestor conferido.");
    return;
  }
  const org = await prisma.organization.create({
    data: {
      name: "Barbearia VIP (dev)",
      users: { create: { email, name: "Dono da Rede", passwordHash: await bcrypt.hash("senha12345", 10), role: "OWNER" } },
    },
  });
  const units = [
    { name: "Unidade Centro", city: "São Paulo", timezone: "America/Sao_Paulo" },
    { name: "Unidade Manaus", city: "Manaus", timezone: "America/Manaus" },
    { name: "Unidade Recife", city: "Recife", timezone: "America/Recife" },
  ];
  for (const [i, u] of units.entries()) {
    const unit = await prisma.unit.create({ data: { organizationId: org.id, ...u } });
    await prisma.connectedAccount.createMany({
      data: [
        { organizationId: org.id, unitId: unit.id, platform: "FACEBOOK_PAGE", externalId: `fb-dev-${i}`, displayName: `${u.name} (Page)`, accessTokenEnc: cipher.encrypt("fake-token") },
        { organizationId: org.id, unitId: unit.id, platform: "INSTAGRAM", externalId: `ig-dev-${i}`, displayName: `@barbeariavip_${i}`, accessTokenEnc: cipher.encrypt("fake-token"), parentExternalId: `fb-dev-${i}` },
        { organizationId: org.id, unitId: unit.id, platform: "GOOGLE_BUSINESS_PROFILE", externalId: `accounts/dev/locations/${i}`, displayName: `${u.name} (Google)`, accessTokenEnc: cipher.encrypt("fake-token"), refreshTokenEnc: cipher.encrypt("fake-refresh"), tokenExpiresAt: new Date(Date.now() + 3600_000) },
      ],
    });
  }
  await ensureManager(org.id);
  console.log(`Seed ok. Logins: ${email} / senha12345 (admin) e gestor@rede.local / senha12345 (gestor)`);
}

/** Gestor de exemplo com acesso só à Unidade Manaus (idempotente). */
async function ensureManager(organizationId: string) {
  const email = "gestor@rede.local";
  if (await prisma.user.findUnique({ where: { email } })) return;
  const manaus = await prisma.unit.findFirst({ where: { organizationId, name: "Unidade Manaus" } });
  await prisma.user.create({
    data: {
      organizationId, email, name: "Gestor Manaus", role: "MANAGER",
      passwordHash: await bcrypt.hash("senha12345", 10),
      units: manaus ? { create: [{ unitId: manaus.id }] } : undefined,
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import { expect, test } from "@playwright/test";
import { prisma, uniqueEmail } from "./helpers";

test("admin agenda um aviso e vê na lista; gestor não tem menu nem API", async ({ page, browser }) => {
  const adminEmail = uniqueEmail("admin");
  await page.goto("/registro");
  await page.fill("#organizationName", "Rede Avisos");
  await page.fill("#name", "Admin");
  await page.fill("#email", adminEmail);
  await page.fill("#password", "senha-forte-123");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
  const unit = await prisma.unit.create({ data: { organizationId: admin.organizationId, name: "Unidade Avisos", whatsappChatId: "120363000000000001@g.us" } });

  await page.goto("/avisos");
  await page.fill("#notice-text", "Lembrete: *fechamento de caixa* hoje.");
  await page.locator("label.chip", { hasText: "Unidade Avisos" }).click();
  const future = new Date(Date.now() + 2 * 86_400_000);
  await page.fill("#notice-when", `${future.toISOString().slice(0, 10)}T10:30`);
  await page.click("button:has-text('Agendar aviso')");
  await expect(page.locator(".alert.ok")).toContainText("Aviso agendado");
  await expect(page.locator("table").first()).toContainText("fechamento de caixa");
  const saved = await prisma.whatsappNotice.findFirstOrThrow({ where: { organizationId: admin.organizationId } });
  expect(saved.state).toBe("ativo");
  expect((saved.targets as { unidades: string[] }).unidades).toEqual([unit.id]);

  // gestor: sem link, página redireciona, API 403
  const managerEmail = uniqueEmail("gestor");
  await prisma.user.create({ data: { organizationId: admin.organizationId, email: managerEmail, name: "Gestor", role: "MANAGER", passwordHash: admin.passwordHash } });
  const ctx = await browser.newContext();
  const mp = await ctx.newPage();
  await mp.goto("/login");
  await mp.fill("#email", managerEmail);
  await mp.fill("#password", "senha-forte-123");
  await mp.click("button[type=submit]");
  await expect(mp.getByRole("heading", { name: "Painel" })).toBeVisible();
  await expect(mp.getByRole("link", { name: "Avisos WhatsApp" })).toHaveCount(0);
  await mp.goto("/avisos");
  await expect(mp).toHaveURL(/\/($|\?)/);
  expect((await mp.request.get("/api/whatsapp-notices")).status()).toBe(403);
  await ctx.close();

  // limpeza: o cancelamento tira o job da fila; o aviso de teste não fica ativo no Redis local
  await page.request.post(`/api/whatsapp-notices/${saved.id}/state`, { data: { state: "cancelado" } });
});

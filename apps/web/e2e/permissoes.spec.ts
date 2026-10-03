import { expect, test } from "@playwright/test";
import { prisma, seedUnitWithAccounts, uniqueEmail } from "./helpers";

async function register(page: import("@playwright/test").Page, email: string) {
  await page.goto("/registro");
  await page.fill("#organizationName", "Rede Permissões");
  await page.fill("#name", "Admin");
  await page.fill("#email", email);
  await page.fill("#password", "senha-forte-123");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();
}

test("admin cria gestor com uma unidade delegada; gestor só vê essa unidade e não cria unidades", async ({ page, browser }) => {
  const adminEmail = uniqueEmail("admin");
  const managerEmail = uniqueEmail("gestor");
  await register(page, adminEmail);

  const norte = await seedUnitWithAccounts(adminEmail, "Unidade Norte");
  await seedUnitWithAccounts(adminEmail, "Unidade Sul");

  // admin cria o gestor pela tela de usuários, delegando só a Unidade Norte
  await page.goto("/usuarios");
  await page.fill("#u-name", "Gestora Norte");
  await page.fill("#u-email", managerEmail);
  await page.fill("#u-pass", "senha-gestor-123");
  await page.locator("form.card label.chip", { hasText: "Unidade Norte" }).click();
  await page.click("button:has-text('Criar usuário')");
  await expect(page.locator(".alert.ok")).toContainText("Usuário criado");

  const created = await prisma.user.findUniqueOrThrow({ where: { email: managerEmail }, include: { units: true } });
  expect(created.role).toBe("MANAGER");
  expect(created.units.map((u) => u.unitId)).toEqual([norte.id]);

  // gestor entra em outra sessão
  const ctx = await browser.newContext();
  const mp = await ctx.newPage();
  await mp.goto("/login");
  await mp.fill("#email", managerEmail);
  await mp.fill("#password", "senha-gestor-123");
  await mp.click("button[type=submit]");
  await expect(mp.getByRole("heading", { name: "Painel" })).toBeVisible();

  await mp.goto("/novo");
  await expect(mp.locator("fieldset.unit-pick legend", { hasText: "Unidade Norte" })).toBeVisible();
  await expect(mp.locator("fieldset.unit-pick legend", { hasText: "Unidade Sul" })).toHaveCount(0);

  await mp.goto("/unidades");
  await expect(mp.locator("#name")).toHaveCount(0); // sem formulário de nova unidade
  await expect(mp.getByText("Só o administrador cadastra unidades")).toBeVisible();

  // sem link e sem acesso à gestão de usuários
  await expect(mp.getByRole("link", { name: "Usuários" })).toHaveCount(0);
  const forbidden = await mp.request.post("/api/units", { data: { name: "Tentativa", timezone: "America/Sao_Paulo" } });
  expect(forbidden.status()).toBe(403);
  const usersApi = await mp.request.get("/api/users");
  expect(usersApi.status()).toBe(403);
  await ctx.close();
});

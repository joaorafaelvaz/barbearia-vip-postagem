import { expect, test } from "@playwright/test";
import { prisma, seedUnitWithAccounts, uniqueEmail } from "./helpers";

test.describe("fluxo principal", () => {
  test("registro, criar unidade, agendar post em massa e ver no painel", async ({ page }) => {
    const email = uniqueEmail();

    await page.goto("/registro");
    await page.fill("#organizationName", "Rede E2E");
    await page.fill("#name", "Dona Rede");
    await page.fill("#email", email);
    await page.fill("#password", "senha-forte-123");
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/\/($|\?)/);
    await expect(page.getByRole("heading", { name: "Painel" })).toBeVisible();

    // cria uma unidade pela UI
    await page.goto("/unidades");
    await page.fill("#name", "Unidade Centro");
    await page.fill("#city", "São Paulo");
    await page.click("button:has-text('Adicionar unidade')");
    await expect(page.getByText("Unidade Centro")).toBeVisible();

    // contas conectadas vêm do seed (OAuth real não roda em teste)
    await seedUnitWithAccounts(email, "Unidade Norte", "America/Manaus");

    await page.goto("/novo");
    await page.fill("#caption", "Promoção de inauguração: corte + barba com 20% off.");
    const future = new Date(Date.now() + 2 * 86_400_000);
    const local = `${future.toISOString().slice(0, 10)}T10:30`;
    await page.fill("#when", local);
    await page.click("button:has-text('Selecionar todas')");

    // Instagram exige imagem: sem upload, a UI bloqueia o botão e explica o motivo
    await expect(page.locator("button:has-text('Agendar em')")).toBeDisabled();
    await expect(page.locator(".action-bar .why")).toContainText("Instagram exige");

    // desmarca o Instagram e agenda nas outras duas
    await page.click("label.chip:has-text('Instagram')");
    await page.click("button:has-text('Agendar em 2 contas')");
    await expect(page).toHaveURL(/\/\?ok=1/);
    await expect(page.getByText("Postagem agendada em todas as contas selecionadas.")).toBeVisible();

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const targets = await prisma.postTarget.findMany({ where: { organizationId: user.organizationId }, include: { account: true } });
    expect(targets).toHaveLength(2);
    expect(targets.every((t) => t.status === "SCHEDULED")).toBe(true);
    // 10:30 em Manaus (UTC-4) = 14:30Z
    expect(targets[0]!.scheduledAt.toISOString()).toBe(`${future.toISOString().slice(0, 10)}T14:30:00.000Z`);

    // painel do mês do agendamento mostra a unidade e permite cancelar
    await page.goto(`/?mes=${local.slice(0, 7)}`);
    await expect(page.getByRole("cell", { name: "Unidade Norte" }).first()).toBeVisible();
    await page.locator("tbody button:has-text('Cancelar')").first().click();
    await expect(page.locator(".badge.CANCELLED").first()).toBeVisible();

    // "Re-tentar todas" do mês reenfileira a cancelada (confirmação aceita)
    page.once("dialog", (d) => d.accept());
    await page.click("button:has-text('Re-tentar todas (1)')");
    await expect(page.locator(".badge.CANCELLED")).toHaveCount(0);
    await expect(page.locator(".badge.SCHEDULED")).toHaveCount(2);
  });

  test("rota protegida redireciona para login", async ({ page }) => {
    await page.goto("/novo");
    await expect(page).toHaveURL(/\/login\?next=%2Fnovo/);
  });

  test("API sem sessão responde 401", async ({ request }) => {
    const res = await request.get("/api/posts");
    expect(res.status()).toBe(401);
  });
});

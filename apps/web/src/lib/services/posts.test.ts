import { describe, expect, it } from "vitest";
import { buildTargets } from "./posts";

const unitSP = { id: "u1", name: "Centro", timezone: "America/Sao_Paulo" };
const unitMAO = { id: "u2", name: "Manaus", timezone: "America/Manaus" };
const accounts = [
  { id: "a1", platform: "FACEBOOK_PAGE" as const, isActive: true, unit: unitSP },
  { id: "a2", platform: "INSTAGRAM" as const, isActive: true, unit: unitSP },
  { id: "a3", platform: "GOOGLE_BUSINESS_PROFILE" as const, isActive: true, unit: unitMAO },
];
const now = new Date("2026-10-01T12:00:00Z");

describe("buildTargets", () => {
  it("gera um target por conta com UTC calculado pelo fuso de cada unidade", () => {
    const targets = buildTargets({ caption: "Promo", scheduledLocal: "2026-10-15T09:00" }, accounts, ["IMAGE"], now);
    expect(targets).toHaveLength(3);
    expect(targets.find((t) => t.connectedAccountId === "a1")?.scheduledAt.toISOString()).toBe("2026-10-15T12:00:00.000Z");
    expect(targets.find((t) => t.connectedAccountId === "a3")?.scheduledAt.toISOString()).toBe("2026-10-15T13:00:00.000Z");
  });

  it("rejeita Instagram sem mídia", () => {
    expect(() => buildTargets({ caption: "x", scheduledLocal: "2026-10-15T09:00" }, accounts, [], now)).toThrow(/imagem/);
  });

  it("rejeita texto acima do limite do GBP", () => {
    expect(() =>
      buildTargets({ caption: "a".repeat(1_600), scheduledLocal: "2026-10-15T09:00" }, accounts, ["IMAGE"], now),
    ).toThrow(/1500/);
  });

  it("rejeita vídeo quando há conta do Google selecionada", () => {
    expect(() => buildTargets({ caption: "x", scheduledLocal: "2026-10-15T09:00" }, accounts, ["VIDEO"], now)).toThrow(/Google Meu Negócio não aceita vídeo/);
  });

  it("aceita um vídeo para Instagram e Facebook", () => {
    const only = accounts.filter((a) => a.platform !== "GOOGLE_BUSINESS_PROFILE");
    expect(buildTargets({ caption: "x", scheduledLocal: "2026-10-15T09:00" }, only, ["VIDEO"], now)).toHaveLength(2);
  });

  it("rejeita horário no passado", () => {
    expect(() => buildTargets({ caption: "x", scheduledLocal: "2026-09-01T09:00" }, accounts, ["IMAGE"], now)).toThrow(/já passou/);
  });
});

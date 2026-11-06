import { describe, expect, it } from "vitest";
import { dailySeries, engagementScore, errorCode, successRate } from "./analytics-utils";

describe("analytics-utils", () => {
  it("dailySeries preenche dias sem dados e conta por dia no fuso", () => {
    const from = new Date("2026-10-01T12:00:00Z");
    const to = new Date("2026-10-03T12:00:00Z");
    const s = dailySeries(
      [
        { at: new Date("2026-10-01T23:30:00Z"), ok: true, timeZone: "America/Sao_Paulo" }, // 20:30 do dia 1 em SP
        { at: new Date("2026-10-03T01:00:00Z"), ok: false, timeZone: "America/Sao_Paulo" }, // 22:00 do dia 2 em SP
      ],
      from, to, "America/Sao_Paulo",
    );
    expect(s.map((d) => d.day)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(s[0]).toMatchObject({ published: 1, failed: 0 });
    expect(s[1]).toMatchObject({ published: 0, failed: 1 });
    expect(s[2]).toMatchObject({ published: 0, failed: 0 });
  });

  it("errorCode lê o prefixo e cai em UNKNOWN", () => {
    expect(errorCode("[INVALID_TOKEN] Token expirado")).toBe("INVALID_TOKEN");
    expect(errorCode("sem prefixo")).toBe("UNKNOWN");
    expect(errorCode(null)).toBe("UNKNOWN");
  });

  it("successRate e engagementScore", () => {
    expect(successRate(0, 0)).toBe(0);
    expect(successRate(3, 1)).toBe(75);
    expect(engagementScore({ likes: 10, comments: 2, shares: 1, saves: 1 })).toBe(10 + 4 + 3 + 2);
  });
});

describe("getAnalytics agrega importadas por unidade sem corromper o agrupamento", () => {
  it("soma curtidas de várias publicações da mesma unidade", async () => {
    const { getAnalytics } = await import("./services/analytics");
    const unit = { id: "u1", name: "Centro", timezone: "America/Sao_Paulo" };
    const ext = (id: string, likes: number) => ({ id, platform: "INSTAGRAM", caption: id, likes, comments: 1, shares: 0, reach: 0, impressions: 0, saves: 0, clicks: 0, partial: true, permalink: null, metricsFetchedAt: null, publishedAt: new Date(), account: { platform: "INSTAGRAM", unit } });
    const prisma = { postTarget: { findMany: async () => [] }, externalPost: { findMany: async () => [ext("a", 10), ext("b", 20), ext("c", 30)] }, connectedAccount: { findMany: async () => [] } } as never;
    const d = await getAnalytics(prisma, "org", null, { days: 30 });
    expect(d.totals.imported).toBe(3);
    expect(d.totals.successRate).toBe(100);
    expect(d.byUnit).toHaveLength(1);
    expect(d.byUnit[0]).toMatchObject({ name: "Centro", published: 3, failed: 0, likes: 60, comments: 3 });
    expect(d.byPlatform[0]).toMatchObject({ platform: "INSTAGRAM", published: 3, likes: 60 });
    expect(d.engagement.likes).toBe(60);
    expect(d.profile).toMatchObject({ accounts: 0 });
  });
});

describe("getAnalytics: desempenho do perfil no Google Meu Negócio", () => {
  const day = (iso: string, impressionsSearch: number, callClicks = 0) => ({ date: new Date(iso), impressionsSearch, impressionsMaps: 1, websiteClicks: 0, callClicks, directionRequests: 0, messagingClicks: 0, bookings: 0 });
  const accounts = [
    { id: "g1", displayName: "Barbearia Centro", profileMetricsAt: new Date("2026-11-06T10:00:00Z"), profileMetricsError: null, unit: { name: "Centro" }, profileMetrics: [day("2026-11-01T00:00:00Z", 100, 2), day("2026-11-02T00:00:00Z", 50)] },
    { id: "g2", displayName: "Barbearia Norte", profileMetricsAt: new Date("2026-11-06T10:00:00Z"), profileMetricsError: "[PERMISSION_DENIED] Business Profile Performance API has not been used in project 1", unit: { name: "Norte" }, profileMetrics: [] },
  ];
  const prisma = { postTarget: { findMany: async () => [] }, externalPost: { findMany: async () => [] }, connectedAccount: { findMany: async () => accounts } } as never;

  it("soma por unidade e no total, lista erros e o último dia com dados", async () => {
    const { getAnalytics } = await import("./services/analytics");
    const d = await getAnalytics(prisma, "org", null, { days: 30 });
    expect(d.profile?.accounts).toBe(2);
    expect(d.profile?.totals).toMatchObject({ impressionsSearch: 150, impressionsMaps: 2, callClicks: 2 });
    expect(d.profile?.byUnit[0]).toMatchObject({ unit: "Centro", account: "Barbearia Centro", days: 2, impressionsSearch: 150 });
    expect(d.profile?.byUnit[1]).toMatchObject({ unit: "Norte", days: 0, impressionsSearch: 0 });
    expect(d.profile?.errors).toEqual([{ accountId: "g2", unit: "Norte", account: "Barbearia Norte", message: expect.stringContaining("Performance API") }]);
    expect(d.profile?.lastDay).toBe("02/11/2026");
    expect(d.profile?.lastFetchedAt?.toISOString()).toBe("2026-11-06T10:00:00.000Z");
  });

  it("filtro de outra plataforma oculta a seção", async () => {
    const { getAnalytics } = await import("./services/analytics");
    const d = await getAnalytics(prisma, "org", null, { days: 30, platform: "INSTAGRAM" });
    expect(d.profile).toBeNull();
  });
});

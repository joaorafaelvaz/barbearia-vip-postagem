import { describe, expect, it } from "vitest";
import { GoogleBusinessPerformanceClient, performanceLocationName } from "../google-performance.js";
import { account, fakeFetch } from "./helpers.js";

const dv = (day: number, value?: string) => ({ date: { year: 2026, month: 11, day }, ...(value ? { value } : {}) });

describe("GoogleBusinessPerformanceClient", () => {
  it("usa só o id da location", () => {
    expect(performanceLocationName("accounts/1/locations/2")).toBe("locations/2");
    expect(() => performanceLocationName("pagina-123")).toThrow();
  });

  it("soma impressões por dia e lê cliques, rotas e mensagens", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [
        { dailyMetric: "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", timeSeries: { datedValues: [dv(1, "10"), dv(2, "5")] } },
        { dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", timeSeries: { datedValues: [dv(1, "90"), dv(2)] } },
        { dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_MAPS", timeSeries: { datedValues: [dv(1, "7")] } },
        { dailyMetric: "WEBSITE_CLICKS", timeSeries: { datedValues: [dv(2, "3")] } },
        { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [dv(1, "2")] } },
        { dailyMetric: "BUSINESS_DIRECTION_REQUESTS", timeSeries: { datedValues: [dv(1, "4")] } },
        { dailyMetric: "MESSAGING_CLICKS", timeSeries: { datedValues: [dv(2, "1")] } },
      ] }] } }),
    ]);
    const points = await new GoogleBusinessPerformanceClient({ fetch }).fetchDaily(account.gbp, new Date("2026-11-01T00:00:00Z"), new Date("2026-11-02T00:00:00Z"));
    expect(points).toEqual([
      { date: "2026-11-01", impressionsSearch: 100, impressionsMaps: 7, websiteClicks: 0, callClicks: 2, directionRequests: 4, messagingClicks: 0, bookings: 0 },
      { date: "2026-11-02", impressionsSearch: 5, impressionsMaps: 0, websiteClicks: 3, callClicks: 0, directionRequests: 0, messagingClicks: 1, bookings: 0 },
    ]);
    const url = calls[0]?.url ?? "";
    expect(url).toContain("/v1/locations/2:fetchMultiDailyMetricsTimeSeries?");
    expect(url).toContain("dailyMetrics=WEBSITE_CLICKS");
    expect(url).toContain("dailyRange.start_date.year=2026&dailyRange.start_date.month=11&dailyRange.start_date.day=1");
    expect(url).toContain("dailyRange.end_date.day=2");
  });

  it("API desabilitada no projeto vira PERMISSION_DENIED com a mensagem do Google", async () => {
    const { fetch } = fakeFetch([() => ({ status: 403, json: { error: { message: "Business Profile Performance API has not been used in project 1 before or it is disabled." } } })]);
    await expect(new GoogleBusinessPerformanceClient({ fetch }).fetchDaily(account.gbp, new Date(), new Date())).rejects.toMatchObject({ code: "PERMISSION_DENIED", message: expect.stringContaining("Performance API") });
  });
});

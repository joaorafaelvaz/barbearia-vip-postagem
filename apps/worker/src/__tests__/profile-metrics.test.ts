import { PublishError } from "@fsp/core";
import { describe, expect, it } from "vitest";
import { collectProfileMetrics, type ProfileAccount, type ProfileMetricsRepository } from "../profile-metrics.js";

const acc = (id: string): ProfileAccount => ({
  id, organizationId: "org", platform: "GOOGLE_BUSINESS_PROFILE", externalId: `accounts/1/locations/${id}`, accessTokenEnc: "enc", refreshTokenEnc: "r", tokenExpiresAt: null,
});

function fakeRepo(accounts: ProfileAccount[]) {
  const saved: Array<{ id: string; days: string[]; at: Date }> = [];
  const errors: Array<{ id: string; error: string }> = [];
  const repo: ProfileMetricsRepository = {
    async listGoogleAccounts() { return accounts; },
    async savePoints(a, points, at) { saved.push({ id: a.id, days: points.map((p) => p.date), at }); },
    async saveError(a, error) { errors.push({ id: a.id, error }); },
  };
  return { repo, saved, errors };
}

describe("collectProfileMetrics", () => {
  const now = () => new Date("2026-11-06T15:30:00-03:00");

  it("pede a janela até ontem (UTC) e grava os dias de cada conta", async () => {
    const { repo, saved, errors } = fakeRepo([acc("a"), acc("b")]);
    const ranges: Array<[string, string]> = [];
    const out = await collectProfileMetrics({
      repo,
      now,
      windowDays: 7,
      credentials: async (a) => ({ platform: a.platform, externalId: a.externalId, accessToken: "tok" }),
      fetchDaily: async (_c, from, to) => {
        ranges.push([from.toISOString(), to.toISOString()]);
        return [{ date: "2026-11-01", impressionsSearch: 1, impressionsMaps: 0, websiteClicks: 0, callClicks: 0, directionRequests: 0, messagingClicks: 0, bookings: 0 }];
      },
    });
    expect(out).toEqual({ accounts: 2, updated: 2, failed: 0, days: 2 });
    expect(ranges[0]).toEqual(["2026-10-30T00:00:00.000Z", "2026-11-05T00:00:00.000Z"]);
    expect(saved.map((s) => s.id)).toEqual(["a", "b"]);
    expect(saved[0]?.days).toEqual(["2026-11-01"]);
    expect(errors).toEqual([]);
  });

  it("erro em uma conta é registrado nela e não interrompe as outras", async () => {
    const { repo, saved, errors } = fakeRepo([acc("a"), acc("b")]);
    const out = await collectProfileMetrics({
      repo,
      now,
      credentials: async (a) => ({ platform: a.platform, externalId: a.externalId, accessToken: "tok" }),
      fetchDaily: async (c) => {
        if (c.externalId.endsWith("/a")) throw new PublishError("PERMISSION_DENIED", "Business Profile Performance API has not been used in project 1");
        return [];
      },
    });
    expect(out).toEqual({ accounts: 2, updated: 1, failed: 1, days: 0 });
    expect(saved.map((s) => s.id)).toEqual(["b"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.id).toBe("a");
    expect(errors[0]?.error).toContain("PERMISSION_DENIED");
  });
});

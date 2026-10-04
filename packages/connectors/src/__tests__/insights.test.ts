import { describe, expect, it } from "vitest";
import { FacebookInsights, GoogleBusinessInsights, InstagramInsights } from "../insights.js";
import { account, fakeFetch } from "./helpers.js";

describe("insights", () => {
  it("Facebook: campos + insights completos", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { likes: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } }, shares: { count: 2 } } }),
      () => ({ json: { data: [
        { name: "post_impressions", values: [{ value: 500 }] },
        { name: "post_impressions_unique", values: [{ value: 420 }] },
        { name: "post_clicks", values: [{ value: 15 }] },
      ] } }),
    ]);
    const m = await new FacebookInsights({ fetch }).fetch(account.fb, "page123_1");
    expect(m).toMatchObject({ likes: 12, comments: 3, shares: 2, impressions: 500, reach: 420, clicks: 15, partial: false });
    expect(calls[0]?.url).toContain("/page123_1?fields=");
    expect(calls[1]?.url).toContain("/page123_1/insights?metric=post_impressions");
  });

  it("Facebook sem read_insights: contagens vêm e o resto fica parcial", async () => {
    const { fetch } = fakeFetch([
      () => ({ json: { likes: { summary: { total_count: 7 } }, comments: { summary: { total_count: 0 } } } }),
      () => ({ status: 403, json: { error: { code: 10, message: "(#10) requires read_insights" } } }),
    ]);
    const m = await new FacebookInsights({ fetch }).fetch(account.fb, "p");
    expect(m.likes).toBe(7);
    expect(m.partial).toBe(true);
    expect(m.note).toMatch(/read_insights/);
  });

  it("Instagram reels: like/comments + reach, plays, saved", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { like_count: 40, comments_count: 5, media_product_type: "REELS" } }),
      () => ({ json: { data: [
        { name: "reach", values: [{ value: 900 }] },
        { name: "saved", values: [{ value: 11 }] },
        { name: "shares", values: [{ value: 4 }] },
        { name: "plays", values: [{ value: 1200 }] },
      ] } }),
    ]);
    const m = await new InstagramInsights({ fetch }).fetch(account.ig, "m1");
    expect(m).toMatchObject({ likes: 40, comments: 5, reach: 900, saves: 11, shares: 4, impressions: 1200, partial: false });
    expect(calls[1]?.url).toContain("metric=reach,saved,shares,plays");
  });

  it("Google: visualizações e cliques do localPost", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { localPostMetrics: [{ metricValues: [
        { metric: "LOCAL_POST_VIEWS_SEARCH", totalValue: { value: "230" } },
        { metric: "LOCAL_POST_ACTIONS_CALL_TO_ACTION", totalValue: { value: "9" } },
      ] }] } }),
    ]);
    const m = await new GoogleBusinessInsights({ fetch }).fetch(account.gbp, "accounts/1/locations/2/localPosts/7");
    expect(m).toMatchObject({ impressions: 230, reach: 230, clicks: 9, partial: false });
    expect(calls[0]?.url).toContain("/accounts/1/locations/2/localPosts:reportInsights");
  });

  it("Google sem acesso à API de métricas: parcial, sem lançar erro", async () => {
    const { fetch } = fakeFetch([() => ({ status: 403, json: { error: { message: "no access" } } })]);
    const m = await new GoogleBusinessInsights({ fetch }).fetch(account.gbp, "accounts/1/locations/2/localPosts/7");
    expect(m.partial).toBe(true);
  });
});

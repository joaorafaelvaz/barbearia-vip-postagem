import { describe, expect, it } from "vitest";
import { GoogleBusinessProfilePublisher } from "../google-business.js";
import { refreshGoogleAccessToken } from "../oauth/google.js";
import { account, fakeFetch } from "./helpers.js";

describe("GoogleBusinessProfilePublisher", () => {
  it("cria localPost STANDARD com mídia e Bearer token", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { name: "accounts/1/locations/2/localPosts/777", searchUrl: "https://g.co/x" } }),
    ]);
    const res = await new GoogleBusinessProfilePublisher({ fetch }).publish({
      account: account.gbp,
      caption: "Horário especial",
      mediaUrls: ["https://cdn/a.jpg"],
    });
    expect(res).toEqual({ externalPostId: "accounts/1/locations/2/localPosts/777", externalUrl: "https://g.co/x" });
    const call = calls[0]!;
    expect(call.url).toBe("https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts");
    expect(call.headers.Authorization).toBe("Bearer GOOGLE_ACCESS_SECRET");
    expect(call.body).toMatchObject({
      topicType: "STANDARD",
      summary: "Horário especial",
      media: [{ mediaFormat: "PHOTO", sourceUrl: "https://cdn/a.jpg" }],
    });
  });

  it("401 vira INVALID_TOKEN, 429 vira RATE_LIMITED com retry-after", async () => {
    const a = fakeFetch([() => ({ status: 401, json: { error: { message: "bad" } } })]);
    await expect(
      new GoogleBusinessProfilePublisher({ fetch: a.fetch }).publish({ account: account.gbp, caption: "x", mediaUrls: [] }),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });

    const b = fakeFetch([() => ({ status: 429, json: { error: { message: "quota" } }, headers: { "retry-after": "120" } })]);
    await expect(
      new GoogleBusinessProfilePublisher({ fetch: b.fetch }).publish({ account: account.gbp, caption: "x", mediaUrls: [] }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 120 });
  });

  it("externalId fora do formato accounts/x/locations/y é VALIDATION", async () => {
    const { fetch } = fakeFetch([]);
    await expect(
      new GoogleBusinessProfilePublisher({ fetch }).publish({
        account: { ...account.gbp, externalId: "locations/2" },
        caption: "x",
        mediaUrls: [],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("refreshGoogleAccessToken", () => {
  it("renova e preserva o refresh token quando a resposta não traz um novo", async () => {
    const { fetch, calls } = fakeFetch([() => ({ json: { access_token: "NEW", expires_in: 3600 } })]);
    const now = new Date("2026-10-03T12:00:00Z");
    const t = await refreshGoogleAccessToken(
      { clientId: "cid", clientSecret: "sec", redirectUri: "http://x", fetch },
      "REFRESH",
      now,
    );
    expect(t.accessToken).toBe("NEW");
    expect(t.refreshToken).toBe("REFRESH");
    expect(t.expiresAt.toISOString()).toBe("2026-10-03T13:00:00.000Z");
    expect((calls[0]?.body as Record<string, string>).grant_type).toBe("refresh_token");
  });
});

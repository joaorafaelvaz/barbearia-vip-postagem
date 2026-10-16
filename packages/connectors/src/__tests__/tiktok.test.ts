import { describe, expect, it } from "vitest";
import { TikTokPublisher, chooseTikTokPrivacy } from "../tiktok.js";
import { exchangeTikTokCode, buildTikTokAuthorizeUrl } from "../oauth/tiktok.js";
import { fakeFetch, img, vid } from "./helpers.js";

const noSleep = async () => {};
const acc = { platform: "TIKTOK" as const, externalId: "open-1", accessToken: "TT_TOKEN_SECRET" };

describe("TikTokPublisher", () => {
  it("vídeo: creator_info -> video/init PULL_FROM_URL -> status PUBLISH_COMPLETE", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { data: { privacy_level_options: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], comment_disabled: false }, error: { code: "ok" } } }),
      () => ({ json: { data: { publish_id: "v_pub_1" }, error: { code: "ok" } } }),
      () => ({ json: { data: { status: "PROCESSING_DOWNLOAD" }, error: { code: "ok" } } }),
      () => ({ json: { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: [7345] }, error: { code: "ok" } } }),
    ]);
    const res = await new TikTokPublisher({ fetch, sleep: noSleep }).publish({ account: acc, caption: "Corte novo #barber", media: [vid("https://cdn/v.mp4")], cover: { offsetMs: 2500 } });
    expect(res).toEqual({ externalPostId: "7345" });
    expect(calls[1]?.url).toMatch(/\/post\/publish\/video\/init\/$/);
    const body = calls[1]?.body as Record<string, Record<string, unknown>>;
    expect(body.post_info?.privacy_level).toBe("PUBLIC_TO_EVERYONE");
    expect(body.post_info?.video_cover_timestamp_ms).toBe(2500);
    expect(body.source_info).toEqual({ source: "PULL_FROM_URL", video_url: "https://cdn/v.mp4" });
    expect(calls[1]?.headers.Authorization).toBe("Bearer TT_TOKEN_SECRET");
  });

  it("fotos: content/init com media_type PHOTO e título da primeira linha", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } } }),
      () => ({ json: { data: { publish_id: "p_pub_1" }, error: { code: "ok" } } }),
      () => ({ json: { data: { status: "PUBLISH_COMPLETE" }, error: { code: "ok" } } }),
    ]);
    const res = await new TikTokPublisher({ fetch, sleep: noSleep }).publish({ account: acc, caption: "Antes e depois\nVem pra VIP", media: [img("https://cdn/1.jpg"), img("https://cdn/2.jpg")] });
    expect(res.externalPostId).toBe("p_pub_1");
    const body = calls[1]?.body as Record<string, unknown>;
    expect(body.media_type).toBe("PHOTO");
    expect((body.post_info as Record<string, unknown>).title).toBe("Antes e depois");
    expect((body.post_info as Record<string, unknown>).privacy_level).toBe("SELF_ONLY");
    expect((body.source_info as Record<string, unknown>).photo_images).toEqual(["https://cdn/1.jpg", "https://cdn/2.jpg"]);
  });

  it("status FAILED vira MEDIA_REJECTED com o motivo", async () => {
    const { fetch } = fakeFetch([
      () => ({ json: { data: { privacy_level_options: ["PUBLIC_TO_EVERYONE"] }, error: { code: "ok" } } }),
      () => ({ json: { data: { publish_id: "x" }, error: { code: "ok" } } }),
      () => ({ json: { data: { status: "FAILED", fail_reason: "video_pull_failed" }, error: { code: "ok" } } }),
    ]);
    await expect(new TikTokPublisher({ fetch, sleep: noSleep }).publish({ account: acc, caption: "", media: [vid("https://cdn/v.mp4")] })).rejects.toMatchObject({ code: "MEDIA_REJECTED", message: /video_pull_failed/ });
  });

  it("erro em HTTP 200 (error.code != ok) é mapeado: app não auditado = PERMISSION_DENIED", async () => {
    const { fetch } = fakeFetch([
      () => ({ json: { data: { privacy_level_options: ["SELF_ONLY"] }, error: { code: "ok" } } }),
      () => ({ status: 403, json: { error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "Unaudited" } } }),
    ]);
    await expect(new TikTokPublisher({ fetch, sleep: noSleep }).publish({ account: acc, caption: "", media: [vid("https://cdn/v.mp4")] })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("chooseTikTokPrivacy respeita as opções da conta", () => {
    expect(chooseTikTokPrivacy(["SELF_ONLY"], "PUBLIC_TO_EVERYONE")).toBe("SELF_ONLY");
    expect(chooseTikTokPrivacy(["PUBLIC_TO_EVERYONE", "SELF_ONLY"], "SELF_ONLY")).toBe("SELF_ONLY");
    expect(chooseTikTokPrivacy([], undefined)).toBe("SELF_ONLY");
  });
});

describe("TikTok OAuth", () => {
  it("monta a URL de autorização e troca o code", async () => {
    const url = buildTikTokAuthorizeUrl({ clientKey: "ck", redirectUri: "https://app/cb" }, "st");
    expect(url).toMatch(/^https:\/\/www\.tiktok\.com\/v2\/auth\/authorize\/\?client_key=ck&scope=user\.info\.basic%2Cvideo\.publish/);
    const { fetch, calls } = fakeFetch([() => ({ json: { access_token: "at", expires_in: 86400, refresh_token: "rt", refresh_expires_in: 31536000, open_id: "o1", scope: "video.publish" } })]);
    const t = await exchangeTikTokCode({ clientKey: "ck", clientSecret: "cs", redirectUri: "https://app/cb", fetch }, "code1", new Date("2026-10-15T00:00:00Z"));
    expect(t.openId).toBe("o1");
    expect(t.expiresAt.toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect((calls[0]?.body as Record<string, string>).grant_type).toBe("authorization_code");
  });
});

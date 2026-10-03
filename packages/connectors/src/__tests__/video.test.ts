import { describe, expect, it } from "vitest";
import { FacebookPagePublisher } from "../facebook.js";
import { GoogleBusinessProfilePublisher } from "../google-business.js";
import { InstagramPublisher } from "../instagram.js";
import { account, fakeFetch, img, vid } from "./helpers.js";

const noSleep = async () => {};

describe("vídeo", () => {
  it("Facebook publica vídeo em /videos com file_url e description", async () => {
    const { fetch, calls } = fakeFetch([() => ({ json: { id: "v123" } })]);
    const res = await new FacebookPagePublisher({ fetch }).publish({
      account: account.fb,
      caption: "Reel da semana",
      media: [vid("https://cdn/a.mp4")],
    });
    expect(res).toEqual({ externalPostId: "v123", externalUrl: "https://www.facebook.com/page123/videos/v123" });
    expect(calls[0]?.url).toMatch(/\/page123\/videos$/);
    const body = calls[0]?.body as Record<string, string>;
    expect(body.file_url).toBe("https://cdn/a.mp4");
    expect(body.description).toBe("Reel da semana");
  });

  it("Facebook recusa vídeo misturado com imagem", async () => {
    const { fetch } = fakeFetch([]);
    await expect(
      new FacebookPagePublisher({ fetch }).publish({ account: account.fb, caption: "x", media: [vid("https://cdn/a.mp4"), img("https://cdn/b.jpg")] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("Instagram publica vídeo como REELS com share_to_feed", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { id: "c1" } }),
      () => ({ json: { status_code: "IN_PROGRESS" } }),
      () => ({ json: { status_code: "IN_PROGRESS" } }),
      () => ({ json: { status_code: "FINISHED" } }),
      () => ({ json: { id: "media77" } }),
      () => ({ json: { permalink: "https://www.instagram.com/reel/xyz/" } }),
    ]);
    const res = await new InstagramPublisher({ fetch, sleep: noSleep }).publish({
      account: account.ig,
      caption: "Reel",
      media: [vid("https://cdn/a.mp4")],
    });
    expect(res.externalPostId).toBe("media77");
    const body = calls[0]?.body as Record<string, string>;
    expect(body.media_type).toBe("REELS");
    expect(body.video_url).toBe("https://cdn/a.mp4");
    expect(body.share_to_feed).toBe("true");
    expect(body.caption).toBe("Reel");
  });

  it("Google Business Profile recusa vídeo com VALIDATION, sem chamar a API", async () => {
    const { fetch, calls } = fakeFetch([]);
    await expect(
      new GoogleBusinessProfilePublisher({ fetch }).publish({ account: account.gbp, caption: "x", media: [vid("https://cdn/a.mp4")] }),
    ).rejects.toMatchObject({ code: "VALIDATION", retryable: false });
    expect(calls).toHaveLength(0);
  });
});

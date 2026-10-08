import { describe, expect, it } from "vitest";
import { FacebookPagePublisher } from "../facebook.js";
import { GoogleBusinessProfilePublisher } from "../google-business.js";
import { InstagramPublisher } from "../instagram.js";
import { account, fakeFetch, img, vid } from "./helpers.js";

const noSleep = async () => {};

describe("formatos Story e Reel", () => {
  it("Instagram Story com imagem: container STORIES + publish, sem legenda", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { id: "c1" } }),
      () => ({ json: { status_code: "FINISHED" } }),
      () => ({ json: { id: "s1" } }),
    ]);
    const res = await new InstagramPublisher({ fetch, sleep: noSleep }).publish({ account: account.ig, format: "STORY", caption: "ignorada", media: [img("https://cdn/a.jpg")] });
    expect(res.externalPostId).toBe("s1");
    const body = calls[0]?.body as Record<string, string>;
    expect(body.media_type).toBe("STORIES");
    expect(body.image_url).toBe("https://cdn/a.jpg");
    expect(body.caption).toBeUndefined();
  });

  it("Instagram Reel exige vídeo", async () => {
    const { fetch } = fakeFetch([]);
    await expect(new InstagramPublisher({ fetch, sleep: noSleep }).publish({ account: account.ig, format: "REEL", caption: "x", media: [img("https://cdn/a.jpg")] })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("Facebook Reel: start -> upload por URL -> finish PUBLISHED", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { video_id: "v9", upload_url: "https://rupload.facebook.com/video-upload/v26.0/v9" } }),
      () => ({ json: { success: true } }),
      () => ({ json: { success: true, post_id: "page123_9" } }),
    ]);
    const res = await new FacebookPagePublisher({ fetch }).publish({ account: account.fb, format: "REEL", caption: "Reel!", media: [vid("https://cdn/r.mp4")] });
    expect(res).toEqual({ externalPostId: "v9", externalUrl: "https://www.facebook.com/reel/v9" });
    expect(calls[0]?.url).toMatch(/\/page123\/video_reels$/);
    expect((calls[0]?.body as Record<string, string>).upload_phase).toBe("start");
    expect(calls[1]?.url).toBe("https://rupload.facebook.com/video-upload/v26.0/v9");
    expect(calls[1]?.headers.file_url).toBe("https://cdn/r.mp4");
    const finish = calls[2]?.body as Record<string, string>;
    expect(finish).toMatchObject({ upload_phase: "finish", video_id: "v9", video_state: "PUBLISHED", description: "Reel!" });
  });

  it("Facebook Story de foto: foto não publicada + photo_stories", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { id: "ph1" } }),
      () => ({ json: { success: true, post_id: "page123_story" } }),
    ]);
    const res = await new FacebookPagePublisher({ fetch }).publish({ account: account.fb, format: "STORY", caption: "", media: [img("https://cdn/a.jpg")] });
    expect(res.externalPostId).toBe("page123_story");
    expect((calls[0]?.body as Record<string, string>).published).toBe("false");
    expect(calls[1]?.url).toMatch(/\/page123\/photo_stories$/);
    expect((calls[1]?.body as Record<string, string>).photo_id).toBe("ph1");
  });

  it("Facebook Story de vídeo usa video_stories", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { video_id: "v2", upload_url: "https://rupload.facebook.com/video-upload/v26.0/v2" } }),
      () => ({ json: { success: true } }),
      () => ({ json: { success: true, post_id: "page123_vs" } }),
    ]);
    const res = await new FacebookPagePublisher({ fetch }).publish({ account: account.fb, format: "STORY", caption: "", media: [vid("https://cdn/s.mp4")] });
    expect(res.externalPostId).toBe("page123_vs");
    expect(calls[0]?.url).toMatch(/\/page123\/video_stories$/);
  });

  it("Google não aceita Story nem Reel", async () => {
    const { fetch, calls } = fakeFetch([]);
    await expect(new GoogleBusinessProfilePublisher({ fetch }).publish({ account: account.gbp, format: "STORY", caption: "x", media: [img("https://cdn/a.jpg")] })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(calls).toHaveLength(0);
  });
});

describe("Capa do Reel", () => {
  it("Instagram: cover_url quando há imagem; thumb_offset quando só há quadro", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { id: "c1" } }), () => ({ json: { status_code: "FINISHED" } }), () => ({ json: { id: "m1" } }), () => ({ json: { permalink: "https://www.instagram.com/reel/x/" } }),
    ]);
    await new InstagramPublisher({ fetch, sleep: noSleep }).publish({ account: account.ig, format: "REEL", caption: "r", media: [vid("https://cdn/r.mp4")], cover: { imageUrl: "https://cdn/cover.jpg", offsetMs: 4000 } });
    const body = calls[0]?.body as Record<string, string>;
    expect(body.cover_url).toBe("https://cdn/cover.jpg");
    expect(body.thumb_offset).toBeUndefined();

    const second = fakeFetch([
      () => ({ json: { id: "c2" } }), () => ({ json: { status_code: "FINISHED" } }), () => ({ json: { id: "m2" } }), () => ({ json: { permalink: "https://www.instagram.com/reel/y/" } }),
    ]);
    await new InstagramPublisher({ fetch: second.fetch, sleep: noSleep }).publish({ account: account.ig, format: "REEL", caption: "r", media: [vid("https://cdn/r.mp4")], cover: { offsetMs: 4000 } });
    expect((second.calls[0]?.body as Record<string, string>).thumb_offset).toBe("4000");
  });

  it("Facebook: depois do finish envia a imagem para /{video_id}/thumbnails", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { video_id: "v9", upload_url: "https://rupload.facebook.com/video-upload/v26.0/v9" } }),
      () => ({ json: { success: true } }),
      () => ({ json: { success: true, post_id: "p1" } }),
      () => ({ json: { fake: "image-bytes" } }),
      () => ({ json: { success: true } }),
    ]);
    const res = await new FacebookPagePublisher({ fetch }).publish({ account: account.fb, format: "REEL", caption: "Reel!", media: [vid("https://cdn/r.mp4")], cover: { imageUrl: "https://cdn/cover.jpg" } });
    expect(res.externalPostId).toBe("v9");
    expect(calls[3]?.url).toBe("https://cdn/cover.jpg");
    expect(calls[4]?.url).toMatch(/\/v9\/thumbnails$/);
    expect(calls[4]?.method).toBe("POST");
  });

  it("Facebook: falha ao definir a capa não derruba a publicação", async () => {
    const { fetch } = fakeFetch([
      () => ({ json: { video_id: "v9", upload_url: "https://rupload.facebook.com/video-upload/v26.0/v9" } }),
      () => ({ json: { success: true } }),
      () => ({ json: { success: true } }),
      () => ({ status: 404, json: {} }),
    ]);
    const res = await new FacebookPagePublisher({ fetch }).publish({ account: account.fb, format: "REEL", caption: "Reel!", media: [vid("https://cdn/r.mp4")], cover: { imageUrl: "https://cdn/missing.jpg" } });
    expect(res.externalPostId).toBe("v9");
  });
});

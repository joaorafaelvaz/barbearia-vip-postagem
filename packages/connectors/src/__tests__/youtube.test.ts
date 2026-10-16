import { describe, expect, it } from "vitest";
import { YouTubePublisher } from "../youtube.js";
import { listYouTubeChannels } from "../oauth/youtube.js";
import { fakeFetch, img, vid } from "./helpers.js";

const acc = { platform: "YOUTUBE" as const, externalId: "UC123", accessToken: "YT_TOKEN_SECRET" };

describe("YouTubePublisher", () => {
  it("baixa o vídeo, abre sessão resumável e envia os bytes; título vem da primeira linha", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { fake: "bytes" }, headers: { "content-type": "video/mp4", "content-length": "16" } }),
      () => ({ json: undefined, headers: { location: "https://upload.google/session/abc" } }),
      () => ({ status: 201, json: { id: "yt9", snippet: {} } }),
    ]);
    const res = await new YouTubePublisher({ fetch, youtubePrivacyStatus: "unlisted" }).publish({ account: acc, format: "REEL", caption: "Título do vídeo\n\nDescrição longa", media: [vid("https://cdn/v.mp4")] });
    expect(res).toEqual({ externalPostId: "yt9", externalUrl: "https://youtu.be/yt9" });
    expect(calls[0]?.url).toBe("https://cdn/v.mp4");
    expect(calls[1]?.url).toMatch(/uploadType=resumable&part=snippet,status$/);
    expect(calls[1]?.headers["X-Upload-Content-Type"]).toBe("video/mp4");
    const meta = calls[1]?.body as { snippet: { title: string; description: string; tags?: string[] }; status: { privacyStatus: string } };
    expect(meta.snippet.title).toBe("Título do vídeo");
    expect(meta.snippet.description).toBe("Título do vídeo\n\nDescrição longa");
    expect(meta.snippet.tags).toEqual(["Shorts"]);
    expect(meta.status.privacyStatus).toBe("unlisted");
    expect(calls[2]?.url).toBe("https://upload.google/session/abc");
    expect(calls[2]?.method).toBe("PUT");
  });

  it("imagens são recusadas e cota estourada vira RATE_LIMITED", async () => {
    await expect(new YouTubePublisher({ fetch: fakeFetch([]).fetch }).publish({ account: acc, caption: "x", media: [img("https://cdn/a.jpg")] })).rejects.toMatchObject({ code: "VALIDATION" });
    const { fetch } = fakeFetch([
      () => ({ json: { fake: "bytes" }, headers: { "content-type": "video/mp4", "content-length": "16" } }),
      () => ({ status: 403, json: { error: { code: 403, message: "The request cannot be completed because you have exceeded your quota.", errors: [{ reason: "quotaExceeded" }] } } }),
    ]);
    await expect(new YouTubePublisher({ fetch }).publish({ account: acc, caption: "x", media: [vid("https://cdn/v.mp4")] })).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true, retryAfterSeconds: 3600 });
  });
});

describe("YouTube OAuth", () => {
  it("lista canais do usuário", async () => {
    const { fetch, calls } = fakeFetch([() => ({ json: { items: [{ id: "UC1", snippet: { title: "Barbearia VIP", customUrl: "@barbeariavip", thumbnails: { default: { url: "https://yt/t.jpg" } } } }] } })]);
    const ch = await listYouTubeChannels("tok", fetch);
    expect(ch).toEqual([{ id: "UC1", title: "Barbearia VIP", customUrl: "@barbeariavip", thumbnailUrl: "https://yt/t.jpg" }]);
    expect(calls[0]?.url).toMatch(/channels\?part=snippet&mine=true/);
  });
});

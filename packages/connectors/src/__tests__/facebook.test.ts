import { describe, expect, it } from "vitest";
import { FacebookPagePublisher } from "../facebook.js";
import { account, fakeFetch } from "./helpers.js";

describe("FacebookPagePublisher", () => {
  it("publica só texto em /feed", async () => {
    const { fetch, calls } = fakeFetch([() => ({ json: { id: "page123_999" } })]);
    const pub = new FacebookPagePublisher({ fetch });
    const res = await pub.publish({ account: account.fb, caption: "Olá", mediaUrls: [] });
    expect(res.externalPostId).toBe("page123_999");
    expect(calls[0]?.url).toMatch(/\/page123\/feed$/);
    expect((calls[0]?.body as Record<string, string>).message).toBe("Olá");
  });

  it("publica uma imagem em /photos e usa post_id", async () => {
    const { fetch, calls } = fakeFetch([() => ({ json: { id: "photo1", post_id: "page123_777" } })]);
    const res = await new FacebookPagePublisher({ fetch }).publish({
      account: account.fb,
      caption: "Promo",
      mediaUrls: ["https://cdn.example.com/a.jpg"],
    });
    expect(res.externalPostId).toBe("page123_777");
    expect(calls[0]?.url).toMatch(/\/page123\/photos$/);
    expect((calls[0]?.body as Record<string, string>).url).toBe("https://cdn.example.com/a.jpg");
  });

  it("várias imagens: fotos unpublished + feed com attached_media", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { id: "p1" } }),
      () => ({ json: { id: "p2" } }),
      () => ({ json: { id: "page123_555" } }),
    ]);
    const res = await new FacebookPagePublisher({ fetch }).publish({
      account: account.fb,
      caption: "Album",
      mediaUrls: ["https://x/1.jpg", "https://x/2.jpg"],
    });
    expect(res.externalPostId).toBe("page123_555");
    expect((calls[0]?.body as Record<string, string>).published).toBe("false");
    const feed = calls[2]?.body as Record<string, string>;
    expect(JSON.parse(feed["attached_media[0]"] ?? "{}")).toEqual({ media_fbid: "p1" });
    expect(JSON.parse(feed["attached_media[1]"] ?? "{}")).toEqual({ media_fbid: "p2" });
  });

  it("mapeia erro 190 para INVALID_TOKEN (não retentável)", async () => {
    const { fetch } = fakeFetch([() => ({ status: 400, json: { error: { code: 190, message: "Token expirado" } } })]);
    await expect(
      new FacebookPagePublisher({ fetch }).publish({ account: account.fb, caption: "x", mediaUrls: [] }),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN", retryable: false });
  });

  it("mapeia erro 4 para RATE_LIMITED (retentável)", async () => {
    const { fetch } = fakeFetch([() => ({ status: 400, json: { error: { code: 4, message: "limit" } } })]);
    await expect(
      new FacebookPagePublisher({ fetch }).publish({ account: account.fb, caption: "x", mediaUrls: [] }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });
});

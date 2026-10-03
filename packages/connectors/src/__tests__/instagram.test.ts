import { describe, expect, it } from "vitest";
import { InstagramPublisher } from "../instagram.js";
import { account, fakeFetch } from "./helpers.js";

const noSleep = async () => {};

describe("InstagramPublisher", () => {
  it("imagem única: container -> poll FINISHED -> publish -> permalink", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { id: "c1" } }),
      () => ({ json: { status_code: "IN_PROGRESS" } }),
      () => ({ json: { status_code: "FINISHED" } }),
      () => ({ json: { id: "media99" } }),
      () => ({ json: { permalink: "https://www.instagram.com/p/abc/" } }),
    ]);
    const res = await new InstagramPublisher({ fetch, sleep: noSleep }).publish({
      account: account.ig,
      caption: "Novo corte",
      mediaUrls: ["https://cdn/x.jpg"],
    });
    expect(res).toEqual({ externalPostId: "media99", externalUrl: "https://www.instagram.com/p/abc/" });
    expect(calls[0]?.url).toMatch(/\/ig456\/media$/);
    expect((calls[0]?.body as Record<string, string>).image_url).toBe("https://cdn/x.jpg");
    expect(calls[3]?.url).toMatch(/\/ig456\/media_publish$/);
    expect((calls[3]?.body as Record<string, string>).creation_id).toBe("c1");
  });

  it("carrossel: filhos com is_carousel_item e container CAROUSEL", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { id: "ch1" } }),
      () => ({ json: { id: "ch2" } }),
      () => ({ json: { id: "car" } }),
      () => ({ json: { status_code: "FINISHED" } }),
      () => ({ json: { id: "media1" } }),
      () => ({ status: 400, json: { error: { code: 100, message: "no permalink" } } }),
    ]);
    const res = await new InstagramPublisher({ fetch, sleep: noSleep }).publish({
      account: account.ig,
      caption: "Album",
      mediaUrls: ["https://cdn/1.jpg", "https://cdn/2.jpg"],
    });
    expect(res.externalPostId).toBe("media1");
    expect(res.externalUrl).toBeUndefined();
    expect((calls[0]?.body as Record<string, string>).is_carousel_item).toBe("true");
    const car = calls[2]?.body as Record<string, string>;
    expect(car.media_type).toBe("CAROUSEL");
    expect(car.children).toBe("ch1,ch2");
  });

  it("sem mídia é VALIDATION", async () => {
    const { fetch } = fakeFetch([]);
    await expect(
      new InstagramPublisher({ fetch, sleep: noSleep }).publish({ account: account.ig, caption: "x", mediaUrls: [] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("container com status ERROR vira MEDIA_REJECTED", async () => {
    const { fetch } = fakeFetch([
      () => ({ json: { id: "c1" } }),
      () => ({ json: { status_code: "ERROR", status: "Media aspect ratio" } }),
    ]);
    await expect(
      new InstagramPublisher({ fetch, sleep: noSleep }).publish({
        account: account.ig,
        caption: "x",
        mediaUrls: ["https://cdn/x.jpg"],
      }),
    ).rejects.toMatchObject({ code: "MEDIA_REJECTED", retryable: false });
  });

  it("nunca inclui o token na mensagem de erro persistida", async () => {
    const { fetch } = fakeFetch([() => ({ status: 500, json: { error: { message: "boom" } } })]);
    try {
      await new InstagramPublisher({ fetch, sleep: noSleep }).publish({
        account: account.ig,
        caption: "x",
        mediaUrls: ["https://cdn/x.jpg"],
      });
    } catch (e) {
      const text = (e as { toPersisted(): string }).toPersisted();
      expect(text).not.toContain("PAGE_TOKEN_SECRET");
      expect(text).toContain("UPSTREAM_UNAVAILABLE");
    }
  });
});

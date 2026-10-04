import { describe, expect, it } from "vitest";
import { FacebookPostLister, GoogleBusinessPostLister, InstagramPostLister } from "../imports.js";
import { account, fakeFetch } from "./helpers.js";

const since = new Date("2026-07-06T00:00:00Z");

describe("importação de publicações existentes", () => {
  it("Facebook: lê contagens, segue paging.next e ignora anteriores a since", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { data: [
        { id: "p1", message: "Oi", created_time: "2026-09-01T10:00:00+0000", permalink_url: "https://fb/p1", likes: { summary: { total_count: 5 } }, comments: { summary: { total_count: 1 } }, shares: { count: 2 }, attachments: { data: [{ media_type: "photo" }] } },
      ], paging: { next: "https://graph.facebook.com/next-page" } } }),
      () => ({ json: { data: [{ id: "p0", created_time: "2026-01-01T10:00:00+0000" }] } }),
    ]);
    const posts = await new FacebookPostLister({ fetch }).list(account.fb, since);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ externalId: "p1", caption: "Oi", likes: 5, comments: 1, shares: 2, mediaType: "photo", permalink: "https://fb/p1" });
    expect(calls[0]?.url).toContain("/page123/posts?");
    expect(calls[0]?.url).toContain("since=");
    expect(calls[1]?.url).toBe("https://graph.facebook.com/next-page");
  });

  it("Instagram: para de paginar ao encontrar mídia anterior a since e marca Reels", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { data: [
        { id: "m2", caption: "Reel", media_type: "VIDEO", media_product_type: "REELS", permalink: "https://ig/m2", timestamp: "2026-09-10T10:00:00+0000", like_count: 30, comments_count: 4 },
        { id: "m1", caption: "Velho", media_type: "IMAGE", timestamp: "2026-01-10T10:00:00+0000", like_count: 1, comments_count: 0 },
      ], paging: { next: "https://graph.facebook.com/should-not-be-called" } } }),
    ]);
    const posts = await new InstagramPostLister({ fetch }).list(account.ig, since);
    expect(posts.map((p) => p.externalId)).toEqual(["m2"]);
    expect(posts[0]?.mediaType).toBe("REELS");
    expect(calls).toHaveLength(1);
  });

  it("Google: lista localPosts com createTime e searchUrl", async () => {
    const { fetch } = fakeFetch([
      () => ({ json: { localPosts: [
        { name: "accounts/1/locations/2/localPosts/9", summary: "Promo", topicType: "STANDARD", createTime: "2026-08-20T12:00:00Z", searchUrl: "https://g/9" },
        { name: "accounts/1/locations/2/localPosts/1", summary: "Antigo", createTime: "2025-12-01T12:00:00Z" },
      ] } }),
    ]);
    const posts = await new GoogleBusinessPostLister({ fetch }).list(account.gbp, since);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ externalId: "accounts/1/locations/2/localPosts/9", caption: "Promo", permalink: "https://g/9" });
  });
});

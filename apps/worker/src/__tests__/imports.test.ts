import { describe, expect, it } from "vitest";
import { importPosts, type ImportAccount, type ImportRepository } from "../imports.js";

const acc = (id: string, platform: ImportAccount["platform"]): ImportAccount => ({
  id, organizationId: "org1", platform, externalId: "x", accessTokenEnc: "enc", refreshTokenEnc: null, tokenExpiresAt: null,
});

describe("importPosts", () => {
  it("importa por conta, conta novos e isola falhas por conta", async () => {
    const stored: Record<string, number> = {};
    const repo: ImportRepository = {
      async listAccounts() { return [acc("a", "FACEBOOK_PAGE"), acc("b", "INSTAGRAM")]; },
      async upsertPosts(a, posts) { stored[a.id] = posts.length; return posts.length; },
    };
    const out = await importPosts({
      repo,
      credentials: async (a) => ({ platform: a.platform, externalId: a.externalId, accessToken: "tok" }),
      listerFor: (p) => ({
        platform: p,
        async list() {
          if (p === "INSTAGRAM") throw new Error("boom");
          return [{ externalId: "p1", caption: "", publishedAt: new Date(), likes: 1, comments: 0, shares: 0 }];
        },
      }),
    });
    expect(out).toEqual({ accounts: 2, imported: 1, created: 1, failed: 1 });
    expect(stored).toEqual({ a: 1 });
  });
});

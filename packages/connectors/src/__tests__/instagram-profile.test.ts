import { describe, expect, it } from "vitest";
import { InstagramProfileClient } from "../instagram-profile.js";
import { fakeFetch } from "./helpers.js";

const T = "PAGE_TOKEN_SECRET";

describe("InstagramProfileClient", () => {
  it("lê o perfil com contadores", async () => {
    const { fetch, calls } = fakeFetch([() => ({ json: { id: "ig1", username: "barbeariavip", followers_count: "1200", follows_count: 10, media_count: 87, profile_picture_url: "https://cdn/p.jpg" } })]);
    const p = await new InstagramProfileClient({ fetch }).getProfile("ig1", T);
    expect(p).toMatchObject({ username: "barbeariavip", followersCount: 1200, followsCount: 10, mediaCount: 87, profilePictureUrl: "https://cdn/p.jpg" });
    expect(calls[0]?.url).toMatch(/\/ig1\?fields=id,username/);
  });

  it("lista mídias com cursor de paginação", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { data: [{ id: "m1", caption: "Oi", media_type: "VIDEO", thumbnail_url: "https://cdn/t.jpg", like_count: 3, comments_count: 1, timestamp: "2026-10-01T10:00:00+0000" }], paging: { cursors: { after: "CUR" }, next: "https://graph/next" } } }),
      () => ({ json: { data: [], paging: { cursors: { after: "END" } } } }),
    ]);
    const c = new InstagramProfileClient({ fetch });
    const page1 = await c.listMedia("ig1", T);
    expect(page1.items[0]).toMatchObject({ id: "m1", mediaType: "VIDEO", likeCount: 3, commentsCount: 1 });
    expect(page1.next).toBe("CUR");
    const page2 = await c.listMedia("ig1", T, "CUR");
    expect(page2.next).toBeUndefined();
    expect(calls[1]?.url).toMatch(/after=CUR/);
  });

  it("exclui mídia com DELETE e falha se success=false", async () => {
    const { fetch, calls } = fakeFetch([() => ({ json: { success: true } }), () => ({ json: { success: false } })]);
    const c = new InstagramProfileClient({ fetch });
    await c.deleteMedia("m1", T);
    expect(calls[0]?.method).toBe("DELETE");
    expect(calls[0]?.url).toMatch(/\/m1\?access_token=/);
    await expect(c.deleteMedia("m2", T)).rejects.toMatchObject({ code: "UNKNOWN" });
  });

  it("comentários: lista com respostas, responde, oculta e exclui", async () => {
    const { fetch, calls } = fakeFetch([
      () => ({ json: { data: [{ id: "c1", text: "Top!", username: "ana", like_count: 2, hidden: false, timestamp: "2026-10-02T10:00:00+0000", replies: { data: [{ id: "r1", text: "Valeu", username: "barbeariavip", like_count: 0, hidden: false, timestamp: "2026-10-02T11:00:00+0000" }] } }] } }),
      () => ({ json: { id: "r2" } }),
      () => ({ json: { success: true } }),
      () => ({ json: { success: true } }),
    ]);
    const c = new InstagramProfileClient({ fetch });
    const list = await c.listComments("m1", T);
    expect(list[0]?.replies[0]?.text).toBe("Valeu");
    expect(await c.replyToComment("c1", T, "Obrigado!")).toEqual({ id: "r2" });
    expect((calls[1]?.body as Record<string, string>).message).toBe("Obrigado!");
    await c.setCommentHidden("c1", T, true);
    expect((calls[2]?.body as Record<string, string>).hide).toBe("true");
    await c.deleteComment("c1", T);
    expect(calls[3]?.method).toBe("DELETE");
  });

  it("erro de permissão vira PERMISSION_DENIED sem vazar o token", async () => {
    const { fetch } = fakeFetch([() => ({ status: 403, json: { error: { code: 10, message: "(#10) Permission denied" } } })]);
    await expect(new InstagramProfileClient({ fetch }).listComments("m1", T)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});

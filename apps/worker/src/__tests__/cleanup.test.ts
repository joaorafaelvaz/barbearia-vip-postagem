import { describe, expect, it } from "vitest";
import { cleanupMedia, type CleanupRepository, type ExpiredMedia } from "../cleanup.js";

function fakeRepo(items: ExpiredMedia[]) {
  const remaining = [...items];
  const deleted: string[] = [];
  const befores: Date[] = [];
  const repo: CleanupRepository = {
    async listExpired(before, limit) { befores.push(before); return remaining.slice(0, limit); },
    async deleteMedia(id) { deleted.push(id); const i = remaining.findIndex((m) => m.id === id); if (i >= 0) remaining.splice(i, 1); },
  };
  return { repo, deleted, befores, remaining };
}

describe("cleanupMedia", () => {
  const now = () => new Date("2026-10-20T12:00:00Z");

  it("apaga arquivo e registro das mídias expiradas e calcula o corte pela retenção", async () => {
    const { repo, deleted, befores } = fakeRepo([{ id: "a", storageKey: "org/a.jpg", kind: "IMAGE" }, { id: "b", storageKey: "org/b.mp4", kind: "VIDEO" }]);
    const removed: string[] = [];
    const out = await cleanupMedia({ repo, storage: { async remove(k) { removed.push(k); } }, retentionDays: 30, now });
    expect(out).toEqual({ deleted: 2, failed: 0, cutoff: "2026-09-20T12:00:00.000Z" });
    expect(removed).toEqual(["org/a.jpg", "org/b.mp4"]);
    expect(deleted).toEqual(["a", "b"]);
    expect(befores[0]?.toISOString()).toBe("2026-09-20T12:00:00.000Z");
  });

  it("falha ao apagar o arquivo mantém o registro para a próxima rodada", async () => {
    const { repo, deleted, remaining } = fakeRepo([{ id: "a", storageKey: "org/a.jpg", kind: "IMAGE" }, { id: "b", storageKey: "org/b.jpg", kind: "IMAGE" }]);
    const out = await cleanupMedia({ repo, storage: { async remove(k) { if (k === "org/a.jpg") throw new Error("EACCES"); } }, retentionDays: 30, now });
    expect(out.deleted).toBe(1);
    expect(out.failed).toBe(1);
    expect(deleted).toEqual(["b"]);
    expect(remaining.map((m) => m.id)).toEqual(["a"]);
  });

  it("processa em lotes até esvaziar", async () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ id: `m${i}`, storageKey: `k${i}`, kind: "IMAGE" }));
    const { repo, deleted } = fakeRepo(items);
    const out = await cleanupMedia({ repo, storage: { async remove() {} }, retentionDays: 30, now, batch: 3 });
    expect(out.deleted).toBe(7);
    expect(deleted.length).toBe(7);
  });
});

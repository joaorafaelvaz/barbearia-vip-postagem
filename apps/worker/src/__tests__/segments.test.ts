import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureStorySegments, needsStorySplit, type SegmentDeps, type SegmentRef, type SegmentRepository, type SourceMedia } from "../segments.js";
import type { Storage } from "../storage.js";

const video: SourceMedia = { id: "m1", organizationId: "org", kind: "VIDEO", storageKey: "org/x.mp4", publicUrl: "https://cdn/x.mp4", width: 1080, height: 1920, durationSec: 105 };

function fakeRepo(media: SourceMedia | null, opts: { claim?: boolean; preset?: SegmentRef[] } = {}) {
  const segments: SegmentRef[] = [...(opts.preset ?? [])];
  const calls = { claim: 0, release: 0, deleted: 0 };
  const repo: SegmentRepository = {
    loadMedia: async () => media,
    listSegments: async () => [...segments],
    claimSplit: async () => { calls.claim++; return opts.claim ?? true; },
    releaseSplit: async () => { calls.release++; },
    deleteSegments: async () => { calls.deleted++; segments.length = 0; },
    createSegment: async (_p, seg) => {
      const ref = { id: `seg${seg.index}`, url: seg.publicUrl, index: seg.index, durationSec: seg.durationSec };
      segments.push(ref);
      return ref;
    },
  };
  return { repo, segments, calls };
}

const memStorage = (puts: string[] = []): Storage => ({
  async put(key) { puts.push(key); return { storageKey: key, publicUrl: `https://cdn/${key}` }; },
});

const fakeSplitter: SegmentDeps["splitter"] = {
  async split(_src, segs, workDir) {
    const out = [];
    for (const s of segs) {
      const file = path.join(workDir, `p${s.index}.mp4`);
      await writeFile(file, Buffer.from(`part-${s.index}`));
      out.push({ index: s.index, file });
    }
    return out;
  },
};

describe("needsStorySplit", () => {
  it("só vídeo acima de 60s", () => {
    expect(needsStorySplit({ kind: "VIDEO", durationSec: 61 })).toBe(true);
    expect(needsStorySplit({ kind: "VIDEO", durationSec: 60 })).toBe(false);
    expect(needsStorySplit({ kind: "IMAGE", durationSec: null })).toBe(false);
  });
});

describe("ensureStorySegments", () => {
  it("corta em partes iguais, grava no storage e solta a trava", async () => {
    const { repo, calls } = fakeRepo(video);
    const puts: string[] = [];
    const parts = await ensureStorySegments({ repo, storage: memStorage(puts), splitter: fakeSplitter }, "m1");
    expect(parts.map((p) => p.index)).toEqual([0, 1]);
    expect(parts[0]?.durationSec).toBe(52.5);
    expect(puts).toEqual(["org/segments/m1-p1.mp4", "org/segments/m1-p2.mp4"]);
    expect(calls).toEqual({ claim: 1, release: 1, deleted: 1 });
  });
  it("devolve vazio quando não precisa cortar", async () => {
    const { repo, calls } = fakeRepo({ ...video, durationSec: 40 });
    expect(await ensureStorySegments({ repo, storage: memStorage(), splitter: fakeSplitter }, "m1")).toEqual([]);
    expect(calls.claim).toBe(0);
  });
  it("reaproveita partes já existentes sem cortar de novo", async () => {
    const preset = [{ id: "a", url: "u1", index: 0, durationSec: 52 }, { id: "b", url: "u2", index: 1, durationSec: 52 }];
    const { repo, calls } = fakeRepo(video, { preset });
    const parts = await ensureStorySegments({ repo, storage: memStorage(), splitter: fakeSplitter }, "m1");
    expect(parts).toEqual(preset);
    expect(calls.claim).toBe(0);
  });
  it("sem a trava, espera outro worker terminar e usa o resultado", async () => {
    const { repo, segments } = fakeRepo(video, { claim: false });
    let t = 0;
    const deps: SegmentDeps = {
      repo, storage: memStorage(), splitter: fakeSplitter,
      now: () => new Date(t), sleep: async (ms) => { t += ms; if (t >= 10_000) segments.push({ id: "a", url: "u1", index: 0, durationSec: 52 }, { id: "b", url: "u2", index: 1, durationSec: 52 }); },
      pollMs: 5_000, waitMs: 60_000,
    };
    const parts = await ensureStorySegments(deps, "m1");
    expect(parts.length).toBe(2);
  });
  it("sem a trava e sem resultado no prazo, erro re-tentável", async () => {
    const { repo } = fakeRepo(video, { claim: false });
    let t = 0;
    const deps: SegmentDeps = { repo, storage: memStorage(), splitter: fakeSplitter, now: () => new Date(t), sleep: async (ms) => { t += ms; }, pollMs: 5_000, waitMs: 20_000 };
    await expect(ensureStorySegments(deps, "m1")).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", retryable: true });
  });
  it("falha do ffmpeg vira MEDIA_REJECTED e solta a trava", async () => {
    const { repo, calls } = fakeRepo(video);
    const broken: SegmentDeps["splitter"] = { split: async () => { throw new Error("ffmpeg não está instalado"); } };
    await expect(ensureStorySegments({ repo, storage: memStorage(), splitter: broken }, "m1")).rejects.toMatchObject({ code: "MEDIA_REJECTED" });
    expect(calls.release).toBe(1);
  });
});

// garante que o tmpdir existe no ambiente de teste (Windows/Linux)
void mkdtemp(path.join(os.tmpdir(), "fsp-test-"));

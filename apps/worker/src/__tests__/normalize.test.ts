import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ensureNormalized, needsNormalization, type NormalizeDeps, type VideoProbe } from "../normalize.js";
import type { SegmentRepository, SourceMedia } from "../segments.js";
import type { Storage } from "../storage.js";

const sdr: VideoProbe = { codec: "h264", pixFmt: "yuv420p", colorTransfer: "bt709", colorPrimaries: "bt709", rFrameRate: "30/1", avgFrameRate: "30/1", width: 1080, height: 1920, durationSec: 12 };

describe("needsNormalization", () => {
  it("H.264 8 bits SDR com fps constante passa sem recodificar", () => {
    expect(needsNormalization(sdr)).toEqual({ needed: false, hdr: false, reasons: [] });
    expect(needsNormalization({ ...sdr, colorTransfer: undefined, colorPrimaries: undefined }).needed).toBe(false);
  });
  it("marcação HLG/BT.2020 (caso do iPhone com tela preta) exige tone mapping", () => {
    const v = needsNormalization({ ...sdr, colorTransfer: "arib-std-b67", colorPrimaries: "bt2020" });
    expect(v.needed).toBe(true);
    expect(v.hdr).toBe(true);
    expect(v.reasons[0]).toMatch(/HDR/);
  });
  it("HEVC, 10 bits, fps variável e dimensões ímpares também", () => {
    expect(needsNormalization({ ...sdr, codec: "hevc" }).reasons).toEqual(["codec hevc"]);
    expect(needsNormalization({ ...sdr, pixFmt: "yuv420p10le" }).reasons).toEqual(["pix_fmt yuv420p10le"]);
    expect(needsNormalization({ ...sdr, avgFrameRate: "29/1" }).reasons).toEqual(["fps variável"]);
    expect(needsNormalization({ ...sdr, width: 1079 }).reasons).toEqual(["dimensões ímpares"]);
  });
});

function fakeRepo(initial: SourceMedia) {
  let media: SourceMedia = { ...initial };
  const calls: string[] = [];
  const repo: SegmentRepository = {
    loadMedia: async () => ({ ...media }),
    listSegments: async () => [],
    claimSplit: async () => { calls.push("claim"); return true; },
    releaseSplit: async () => { calls.push("release"); },
    deleteSegments: async () => {},
    createSegment: async () => { throw new Error("não usado"); },
    markNormalized: async (_id, data) => {
      calls.push(`mark:${data.note}`);
      media = { ...media, normalizedAt: new Date(), normalizeNote: data.note, ...(data.publicUrl ? { publicUrl: data.publicUrl, storageKey: data.storageKey ?? media.storageKey } : {}) };
    },
  };
  return { repo, calls, current: () => media };
}

const video: SourceMedia = { id: "m1", organizationId: "org", kind: "VIDEO", storageKey: "org/x.mp4", publicUrl: "https://cdn/org/x.mp4", width: 1080, height: 1920, durationSec: 12, normalizedAt: null, normalizeNote: null };
const memStorage = (puts: string[] = []): Storage => ({ async put(key) { puts.push(key); return { storageKey: key, publicUrl: `https://cdn/${key}` }; }, localPath: () => "C:/nope/x.mp4" });

describe("ensureNormalized", () => {
  it("vídeo HDR: baixa, recodifica, grava arquivo novo e marca", async () => {
    const { repo, calls, current } = fakeRepo(video);
    const puts: string[] = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(Buffer.from("src"))) as typeof fetch;
    try {
      const probes = [{ ...sdr, colorTransfer: "arib-std-b67", colorPrimaries: "bt2020" }, { ...sdr, durationSec: 11 }];
      const deps: NormalizeDeps = {
        repo, storage: memStorage(puts),
        prober: { probe: async () => probes.shift() as VideoProbe },
        transcoder: { normalize: async (_i, out, opts) => { expect(opts.hdr).toBe(true); await writeFile(out, Buffer.from("normalized-bytes")); } },
      };
      const r = await ensureNormalized(deps, "m1");
      expect(r).toEqual({ changed: true, url: "https://cdn/org/normalized/m1.mp4", note: expect.stringMatching(/recodificado: HDR/) });
      expect(puts).toEqual(["org/normalized/m1.mp4"]);
      expect(calls).toEqual(["claim", expect.stringMatching(/^mark:recodificado/), "release"]);
      expect(current().publicUrl).toBe("https://cdn/org/normalized/m1.mp4");
      // segunda chamada: já normalizado, sem trabalho
      expect((await ensureNormalized(deps, "m1"))?.changed).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
  it("vídeo já no formato seguro só é marcado como ok", async () => {
    const { repo, calls } = fakeRepo(video);
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(Buffer.from("src"))) as typeof fetch;
    try {
      const deps: NormalizeDeps = { repo, storage: memStorage(), prober: { probe: async () => sdr }, transcoder: { normalize: async () => { throw new Error("não deveria recodificar"); } } };
      const r = await ensureNormalized(deps, "m1");
      expect(r?.changed).toBe(false);
      expect(calls[1]).toMatch(/^mark:ok/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
  it("imagem é ignorada", async () => {
    const { repo } = fakeRepo({ ...video, kind: "IMAGE" });
    const deps: NormalizeDeps = { repo, storage: memStorage(), prober: { probe: async () => sdr }, transcoder: { normalize: async () => {} } };
    expect(await ensureNormalized(deps, "m1")).toBeNull();
  });
});

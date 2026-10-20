import { PublishError } from "@fsp/core";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SPLIT_STALE_MS, type SegmentRepository } from "./segments.js";
import type { Storage } from "./storage.js";

/** O que o ffprobe diz sobre a faixa de vídeo. */
export interface VideoProbe {
  codec: string;
  pixFmt: string;
  colorTransfer?: string;
  colorPrimaries?: string;
  rFrameRate: string;
  avgFrameRate: string;
  width: number;
  height: number;
  durationSec: number;
}

const SDR_TRANSFERS = new Set(["bt709", "smpte170m", "bt470bg", "iec61966-2-1", "unknown", ""]);
const HDR_TRANSFERS = new Set(["arib-std-b67", "smpte2084"]);

/**
 * Decide se o vídeo precisa ser recodificado para o formato "seguro" (H.264 8 bits, SDR BT.709,
 * fps constante). Vídeos com marcação HDR (HLG/PQ ou primárias BT.2020) ficam pretos no iPhone
 * quando a transcodificação das plataformas falha; HEVC/10 bits e fps variável também dão problema.
 */
export function needsNormalization(p: VideoProbe): { needed: boolean; hdr: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const hdr = HDR_TRANSFERS.has(p.colorTransfer ?? "") || p.colorPrimaries === "bt2020";
  if (hdr) reasons.push(`HDR (${p.colorTransfer ?? "?"}/${p.colorPrimaries ?? "?"})`);
  if (p.codec !== "h264") reasons.push(`codec ${p.codec}`);
  if (p.pixFmt !== "yuv420p") reasons.push(`pix_fmt ${p.pixFmt}`);
  if (!hdr && p.colorTransfer && !SDR_TRANSFERS.has(p.colorTransfer)) reasons.push(`transfer ${p.colorTransfer}`);
  if (p.rFrameRate !== p.avgFrameRate) reasons.push("fps variável");
  if (p.width % 2 !== 0 || p.height % 2 !== 0) reasons.push("dimensões ímpares");
  return { needed: reasons.length > 0, hdr, reasons };
}

export interface VideoProber {
  probe(input: string): Promise<VideoProbe>;
}

export interface VideoTranscoder {
  normalize(input: string, output: string, opts: { hdr: boolean }): Promise<void>;
}

export interface NormalizeDeps {
  repo: SegmentRepository;
  storage: Storage;
  prober: VideoProber;
  transcoder: VideoTranscoder;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
  waitMs?: number;
  pollMs?: number;
}

export interface NormalizeResult {
  /** true quando o arquivo foi recodificado (URL nova) */
  changed: boolean;
  url: string;
  note: string;
}

/**
 * Garante que o vídeo está no formato seguro. Idempotente (normalizedAt) e com a mesma trava do
 * corte de Stories: um worker processa, os outros esperam. Devolve a URL a usar na publicação.
 */
export async function ensureNormalized(deps: NormalizeDeps, mediaId: string): Promise<NormalizeResult | null> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = deps.log ?? (() => {});

  let media = await deps.repo.loadMedia(mediaId);
  if (!media || media.kind !== "VIDEO") return null;
  if (media.normalizedAt) return { changed: false, url: media.publicUrl, note: media.normalizeNote ?? "" };

  const claimed = await deps.repo.claimSplit(media.id, now(), SPLIT_STALE_MS);
  if (!claimed) {
    const deadline = now().getTime() + (deps.waitMs ?? 15 * 60_000);
    while (now().getTime() < deadline) {
      await sleep(deps.pollMs ?? 5_000);
      media = await deps.repo.loadMedia(mediaId);
      if (media?.normalizedAt) return { changed: false, url: media.publicUrl, note: media.normalizeNote ?? "" };
    }
    throw new PublishError("UPSTREAM_UNAVAILABLE", "A normalização do vídeo ainda está em andamento em outro processo.");
  }

  const workDir = await mkdtemp(path.join(os.tmpdir(), "fsp-norm-"));
  try {
    let input = deps.storage.localPath?.(media.storageKey);
    if (!input || !existsSync(input)) {
      const res = await fetch(media.publicUrl);
      if (!res.ok) throw new Error(`não foi possível baixar o vídeo (HTTP ${res.status}).`);
      input = path.join(workDir, "source");
      await writeFile(input, Buffer.from(await res.arrayBuffer()));
    }
    const probe = await deps.prober.probe(input);
    const verdict = needsNormalization(probe);
    if (!verdict.needed) {
      const note = `ok: ${probe.codec} ${probe.pixFmt} ${probe.colorTransfer ?? "sdr"}`;
      await deps.repo.markNormalized(media.id, { note, width: probe.width, height: probe.height, durationSec: probe.durationSec });
      log("normalize skip", { mediaId: media.id, note });
      return { changed: false, url: media.publicUrl, note };
    }
    log("normalize start", { mediaId: media.id, reasons: verdict.reasons });
    const output = path.join(workDir, "normalized.mp4");
    await deps.transcoder.normalize(input, output, { hdr: verdict.hdr });
    const body = await readFile(output);
    const after = await deps.prober.probe(output);
    const key = `${media.organizationId}/normalized/${media.id}.mp4`;
    const stored = await deps.storage.put(key, body, "video/mp4");
    const note = `recodificado: ${verdict.reasons.join(", ")}`;
    await deps.repo.markNormalized(media.id, {
      note,
      width: after.width,
      height: after.height,
      durationSec: after.durationSec,
      storageKey: stored.storageKey,
      publicUrl: stored.publicUrl,
      bytes: body.length,
      mimeType: "video/mp4",
    });
    log("normalize done", { mediaId: media.id, bytes: body.length });
    return { changed: true, url: stored.publicUrl, note };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PublishError("MEDIA_REJECTED", `Falha ao normalizar o vídeo: ${msg}`, { cause: err });
  } finally {
    await deps.repo.releaseSplit(media.id);
    await rm(workDir, { recursive: true, force: true });
  }
}

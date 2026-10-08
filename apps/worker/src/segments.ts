import { PublishError, STORY_MAX_VIDEO_SECONDS, planStorySegments, type VideoSegment } from "@fsp/core";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Storage } from "./storage.js";

const execFileAsync = promisify(execFile);

/** Asset de origem (vídeo inteiro) como o worker precisa ver. */
export interface SourceMedia {
  id: string;
  organizationId: string;
  kind: string;
  storageKey: string;
  publicUrl: string;
  width: number;
  height: number;
  durationSec: number | null;
}

export interface SegmentRef {
  id: string;
  url: string;
  index: number;
  durationSec: number;
}

export interface SegmentRepository {
  loadMedia(id: string): Promise<SourceMedia | null>;
  listSegments(parentId: string): Promise<SegmentRef[]>;
  /** Assume o corte. true se este worker ficou responsável; travas mais velhas que `staleMs` são retomadas. */
  claimSplit(id: string, now: Date, staleMs: number): Promise<boolean>;
  releaseSplit(id: string): Promise<void>;
  deleteSegments(parentId: string): Promise<void>;
  createSegment(parent: SourceMedia, seg: { index: number; storageKey: string; publicUrl: string; bytes: number; durationSec: number }): Promise<SegmentRef>;
}

export interface SplitSource {
  url: string;
  /** Arquivo já no disco (armazenamento local): evita baixar pela URL pública. */
  localPath?: string;
}

export interface VideoSplitter {
  split(source: SplitSource, segments: readonly VideoSegment[], workDir: string): Promise<Array<{ index: number; file: string }>>;
}

export interface SegmentDeps {
  repo: SegmentRepository;
  storage: Storage;
  splitter: VideoSplitter;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
  /** Quanto um worker concorrente espera o corte de outro terminar. */
  waitMs?: number;
  pollMs?: number;
}

export const SPLIT_STALE_MS = 20 * 60_000;
const DEFAULT_WAIT_MS = 12 * 60_000;
const DEFAULT_POLL_MS = 5_000;

/** True quando a mídia precisa ser cortada para virar Story. */
export function needsStorySplit(media: { kind: string; durationSec: number | null | undefined }): boolean {
  return media.kind === "VIDEO" && (media.durationSec ?? 0) > STORY_MAX_VIDEO_SECONDS;
}

/**
 * Garante as partes de um vídeo para Stories. Idempotente: se já existem, devolve.
 * Só um worker corta por vez (trava em `splitStartedAt`); os demais esperam e reaproveitam.
 * Devolve lista vazia quando a mídia não precisa de corte.
 */
export async function ensureStorySegments(deps: SegmentDeps, mediaId: string): Promise<SegmentRef[]> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = deps.log ?? (() => {});

  const media = await deps.repo.loadMedia(mediaId);
  if (!media) throw new PublishError("VALIDATION", "Mídia da postagem não foi encontrada.");
  if (!needsStorySplit(media)) return [];

  const plan = planStorySegments(media.durationSec ?? 0);
  const existing = await deps.repo.listSegments(media.id);
  if (existing.length === plan.length) return existing;

  const claimed = await deps.repo.claimSplit(media.id, now(), SPLIT_STALE_MS);
  if (!claimed) {
    const deadline = now().getTime() + (deps.waitMs ?? DEFAULT_WAIT_MS);
    while (now().getTime() < deadline) {
      await sleep(deps.pollMs ?? DEFAULT_POLL_MS);
      const ready = await deps.repo.listSegments(media.id);
      if (ready.length === plan.length) return ready;
    }
    throw new PublishError("UPSTREAM_UNAVAILABLE", "O corte do vídeo para Stories ainda está em andamento em outro processo.");
  }

  const workDir = await mkdtemp(path.join(os.tmpdir(), "fsp-split-"));
  try {
    await deps.repo.deleteSegments(media.id);
    const local = deps.storage.localPath?.(media.storageKey);
    const source: SplitSource = { url: media.publicUrl, ...(local && existsSync(local) ? { localPath: local } : {}) };
    log("split start", { mediaId: media.id, parts: plan.length, durationSec: media.durationSec });
    const files = await deps.splitter.split(source, plan, workDir);
    const out: SegmentRef[] = [];
    for (const seg of plan) {
      const produced = files.find((f) => f.index === seg.index);
      if (!produced) throw new Error(`ffmpeg não gerou a parte ${seg.index + 1}.`);
      const body = await readFile(produced.file);
      const key = `${media.organizationId}/segments/${media.id}-p${seg.index + 1}.mp4`;
      const stored = await deps.storage.put(key, body, "video/mp4");
      out.push(await deps.repo.createSegment(media, { index: seg.index, storageKey: stored.storageKey, publicUrl: stored.publicUrl, bytes: body.length, durationSec: seg.lengthSec }));
    }
    log("split done", { mediaId: media.id, parts: out.length });
    return out;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PublishError("MEDIA_REJECTED", `Falha ao cortar o vídeo para Stories: ${msg}`, { cause: err });
  } finally {
    await deps.repo.releaseSplit(media.id);
    await rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Corte com ffmpeg, uma chamada por parte (-ss/-t com re-encode): duração exata,
 * H.264 + AAC, faststart, rotação de celular aplicada. Exige `ffmpeg` no PATH ou FFMPEG_PATH.
 */
export function ffmpegSplitter(bin = process.env.FFMPEG_PATH ?? "ffmpeg"): VideoSplitter {
  return {
    async split(source, segments, workDir) {
      let input = source.localPath;
      if (!input) {
        const res = await fetch(source.url);
        if (!res.ok) throw new Error(`não foi possível baixar o vídeo (HTTP ${res.status}).`);
        input = path.join(workDir, "source");
        await writeFile(input, Buffer.from(await res.arrayBuffer()));
      }
      const out: Array<{ index: number; file: string }> = [];
      for (const seg of segments) {
        const file = path.join(workDir, `part-${seg.index + 1}.mp4`);
        const args = [
          "-y", "-hide_banner", "-loglevel", "error",
          "-ss", seg.startSec.toFixed(2), "-t", seg.lengthSec.toFixed(2), "-i", input,
          "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
          "-movflags", "+faststart", "-map_metadata", "-1",
          file,
        ];
        try {
          await execFileAsync(bin, args, { maxBuffer: 4 * 1024 * 1024 });
        } catch (err) {
          const e = err as NodeJS.ErrnoException & { stderr?: string };
          if (e.code === "ENOENT") throw new Error("ffmpeg não está instalado no worker (instale o pacote ffmpeg ou defina FFMPEG_PATH).");
          throw new Error(`ffmpeg falhou na parte ${seg.index + 1}: ${(e.stderr ?? e.message).trim().slice(0, 300)}`);
        }
        const info = await stat(file);
        if (info.size === 0) throw new Error(`parte ${seg.index + 1} ficou vazia.`);
        out.push({ index: seg.index, file });
      }
      return out;
    },
  };
}

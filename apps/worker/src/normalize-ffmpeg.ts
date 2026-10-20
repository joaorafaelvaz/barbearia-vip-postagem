import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { VideoProber, VideoTranscoder } from "./normalize.js";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 4 * 1024 * 1024;

/** ffprobe em JSON: faixa de vídeo + duração do container. */
export function ffprobeProber(bin = process.env.FFPROBE_PATH ?? "ffprobe"): VideoProber {
  return {
    async probe(input) {
      const { stdout } = await execFileAsync(bin, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", input], { maxBuffer: MAX_BUFFER });
      const data = JSON.parse(stdout) as { streams?: Array<Record<string, unknown>>; format?: { duration?: string } };
      const v = (data.streams ?? []).find((s) => s.codec_type === "video");
      if (!v) throw new Error("arquivo sem faixa de vídeo.");
      const num = (x: unknown) => Number(x) || 0;
      return {
        codec: String(v.codec_name ?? ""),
        pixFmt: String(v.pix_fmt ?? ""),
        ...(typeof v.color_transfer === "string" ? { colorTransfer: v.color_transfer } : {}),
        ...(typeof v.color_primaries === "string" ? { colorPrimaries: v.color_primaries } : {}),
        rFrameRate: String(v.r_frame_rate ?? ""),
        avgFrameRate: String(v.avg_frame_rate ?? ""),
        width: num(v.width),
        height: num(v.height),
        durationSec: Math.round(num(data.format?.duration) || num(v.duration)),
      };
    },
  };
}

/** Formato seguro: H.264 High 8 bits, SDR BT.709 marcado, fps constante, AAC, faststart. */
const SDR_TAGS = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"];
const ENCODE = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-fps_mode", "cfr", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", "-map_metadata", "-1"];
/** HDR -> SDR com tone mapping (zscale/libzimg). Sem zscale no ffmpeg, cai na conversão simples. */
const TONEMAP = "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";
const EVEN = "scale=trunc(iw/2)*2:trunc(ih/2)*2";

export function ffmpegTranscoder(bin = process.env.FFMPEG_PATH ?? "ffmpeg"): VideoTranscoder {
  async function run(input: string, output: string, vf: string): Promise<void> {
    await execFileAsync(bin, ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-vf", vf, ...ENCODE, ...SDR_TAGS, output], { maxBuffer: MAX_BUFFER });
  }
  const describe = (err: unknown): Error => {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT") return new Error("ffmpeg não está instalado no worker.");
    return new Error(`ffmpeg falhou: ${(e.stderr ?? e.message ?? String(err)).trim().slice(0, 300)}`);
  };
  return {
    async normalize(input, output, opts) {
      if (opts.hdr) {
        try {
          await run(input, output, `${TONEMAP},${EVEN}`);
          return;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") throw describe(err);
        }
      }
      try {
        await run(input, output, `${EVEN},format=yuv420p`);
      } catch (err) {
        throw describe(err);
      }
    },
  };
}

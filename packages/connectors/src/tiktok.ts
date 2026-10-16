import { PublishError, type PublishErrorCode } from "@fsp/core";
import { defaultFetch, defaultSleep, readJson, safeFetch } from "./http.js";
import { TIKTOK_API } from "./oauth/tiktok.js";
import type { ConnectorOptions, FetchLike, Publisher, PublishInput, PublishResult } from "./types.js";
import { splitMedia } from "./types.js";

interface TikTokErrorBody {
  error?: { code?: string; message?: string; log_id?: string };
}

/** Mapeia erros da Content Posting API (o código vem em `error.code`, mesmo com HTTP 200). */
export function mapTikTokError(status: number, body: unknown): PublishError {
  const err = (body as TikTokErrorBody | undefined)?.error;
  const code = err?.code ?? "";
  const message = `${err?.message ?? `TikTok respondeu ${status}`}${code ? ` (${code})` : ""}`;
  let kind: PublishErrorCode = "UNKNOWN";
  if (/access_token_invalid|token_expired|invalid_token/.test(code) || status === 401) kind = "INVALID_TOKEN";
  else if (/rate_limit_exceeded|spam_risk_too_many_posts|reached_active_user_cap/.test(code) || status === 429) kind = "RATE_LIMITED";
  else if (/scope_not_authorized|scope_permission_missed|unaudited_client|url_ownership_unverified|privacy_level_option_mismatch|user_banned/.test(code) || status === 403) kind = "PERMISSION_DENIED";
  else if (/pull_failed|picture_size|video_size|file_format|frame_rate|duration|photo|video_/.test(code)) kind = "MEDIA_REJECTED";
  else if (/invalid_param/.test(code) || status === 400) kind = "VALIDATION";
  else if (status >= 500) kind = "UPSTREAM_UNAVAILABLE";
  return new PublishError(kind, message, { upstreamStatus: status });
}

export const TIKTOK_PRIVACY_LEVELS = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"] as const;
const POLL_INTERVAL_MS = 5_000;
const POLL_MAX_ATTEMPTS = 72; // 6 min
const PHOTO_TITLE_LIMIT = 90;
const PHOTO_DESCRIPTION_LIMIT = 4_000;
const VIDEO_TITLE_LIMIT = 2_200;

const clip = (s: string, n: number): string => {
  const chars = [...s];
  return chars.length <= n ? s : chars.slice(0, n).join("");
};

/** Nível de privacidade: o preferido se a conta permitir; senão público; senão o primeiro que a conta aceita. */
export function chooseTikTokPrivacy(options: readonly string[], preferred?: string): string {
  if (preferred && options.includes(preferred)) return preferred;
  if (options.includes("PUBLIC_TO_EVERYONE")) return "PUBLIC_TO_EVERYONE";
  return options[0] ?? "SELF_ONLY";
}

/**
 * Publicação direta no TikTok (Content Posting API, PULL_FROM_URL): o TikTok baixa a mídia
 * da nossa URL pública, que precisa ter o domínio verificado no portal do app. Vídeo → post
 * de vídeo; imagens → post de fotos (carrossel). O resultado é acompanhado por polling.
 */
export class TikTokPublisher implements Publisher {
  readonly platform = "TIKTOK" as const;
  private readonly fetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly preferredPrivacy: string | undefined;

  constructor(options: ConnectorOptions = {}) {
    this.fetch = options.fetch ?? defaultFetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.preferredPrivacy = options.tiktokPrivacyLevel;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const { images, video } = splitMedia(input.media);
    const format = input.format ?? "FEED";
    const token = input.account.accessToken;
    if (format === "STORY") throw new PublishError("VALIDATION", "TikTok não aceita Story.");
    if (!video && images.length === 0) throw new PublishError("VALIDATION", "TikTok exige um vídeo ou imagens.");
    if (video && images.length > 0) throw new PublishError("VALIDATION", "TikTok não aceita vídeo e imagens no mesmo post.");
    if (format === "REEL" && !video) throw new PublishError("VALIDATION", "Reel exige um vídeo.");

    const creator = await this.post("/post/publish/creator_info/query/", token, {});
    const data = (creator.data ?? {}) as { privacy_level_options?: string[]; comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean };
    const privacy = chooseTikTokPrivacy(data.privacy_level_options ?? [], this.preferredPrivacy);

    let publishId: string;
    if (video) {
      const res = await this.post("/post/publish/video/init/", token, {
        post_info: {
          title: clip(input.caption, VIDEO_TITLE_LIMIT),
          privacy_level: privacy,
          disable_duet: data.duet_disabled === true,
          disable_comment: data.comment_disabled === true,
          disable_stitch: data.stitch_disabled === true,
          video_cover_timestamp_ms: Math.max(0, Math.round(input.cover?.offsetMs ?? 1000)),
        },
        source_info: { source: "PULL_FROM_URL", video_url: video },
      });
      publishId = String((res.data as { publish_id?: string } | undefined)?.publish_id ?? "");
    } else {
      const firstLine = input.caption.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ?? "";
      const res = await this.post("/post/publish/content/init/", token, {
        post_info: {
          title: clip(firstLine, PHOTO_TITLE_LIMIT),
          description: clip(input.caption, PHOTO_DESCRIPTION_LIMIT),
          privacy_level: privacy,
          disable_comment: data.comment_disabled === true,
          auto_add_music: true,
        },
        source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: images.slice(0, 35) },
        post_mode: "DIRECT_POST",
        media_type: "PHOTO",
      });
      publishId = String((res.data as { publish_id?: string } | undefined)?.publish_id ?? "");
    }
    if (!publishId) throw new PublishError("UNKNOWN", "TikTok não devolveu publish_id.");
    return this.waitForPublish(publishId, token);
  }

  private async waitForPublish(publishId: string, token: string): Promise<PublishResult> {
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      const res = await this.post("/post/publish/status/fetch/", token, { publish_id: publishId });
      const d = (res.data ?? {}) as { status?: string; fail_reason?: string; publicaly_available_post_id?: Array<string | number> };
      if (d.status === "PUBLISH_COMPLETE") {
        const id = d.publicaly_available_post_id?.[0];
        return { externalPostId: id !== undefined ? String(id) : publishId };
      }
      if (d.status === "FAILED") {
        throw new PublishError("MEDIA_REJECTED", `TikTok recusou a publicação: ${d.fail_reason ?? "motivo não informado"}.`);
      }
      await this.sleep(POLL_INTERVAL_MS);
    }
    throw new PublishError("UNKNOWN", `TikTok não concluiu a publicação a tempo (publish_id ${publishId}); confira no app antes de re-tentar.`);
  }

  private async post(path: string, token: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await safeFetch(this.fetch, `${TIKTOK_API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(body),
    });
    const json = ((await readJson(res)) ?? {}) as Record<string, unknown>;
    const err = (json as TikTokErrorBody).error;
    if (!res.ok || (err?.code && err.code !== "ok")) throw mapTikTokError(res.status, json);
    return json;
  }
}

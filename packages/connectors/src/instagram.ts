import { PublishError } from "@fsp/core";
import { GRAPH_BASE } from "./facebook.js";
import { defaultFetch, defaultSleep, formBody, mapMetaError, readJson, safeFetch } from "./http.js";
import { splitMedia, type ConnectorOptions, type PublishInput, type PublishResult, type Publisher } from "./types.js";

/** Limite publicado pela Meta: 25 posts por conta a cada 24h (via API). */
export const INSTAGRAM_DAILY_LIMIT = 25;

const POLL_INTERVAL_MS = 2_000;
/** Imagens processam em segundos; vídeos (Reels) podem levar minutos. */
const POLL_MAX_ATTEMPTS_IMAGE = 30;
const POLL_MAX_ATTEMPTS_VIDEO = 150;

/**
 * Publica em um Instagram Business/Creator account (Content Publishing API):
 * 1. POST /{ig-user-id}/media  -> container (image_url | video_url+media_type=REELS)
 * 2. GET  /{container}?fields=status_code até FINISHED
 * 3. POST /{ig-user-id}/media_publish {creation_id}
 */
export class InstagramPublisher implements Publisher {
  readonly platform = "INSTAGRAM" as const;
  private readonly fetch;
  private readonly sleep;

  constructor(options: ConnectorOptions = {}) {
    this.fetch = options.fetch ?? defaultFetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const { account, caption } = input;
    const { images, video } = splitMedia(input.media);
    const format = input.format ?? "FEED";
    if (format === "STORY") return this.publishStory(input);
    if (format === "REEL" && !video) {
      throw new PublishError("VALIDATION", "Reel exige um vídeo.");
    }
    if (input.media.length === 0) {
      throw new PublishError("VALIDATION", "Instagram exige pelo menos uma imagem ou vídeo.");
    }
    if (video && images.length > 0) {
      throw new PublishError("VALIDATION", "Instagram não aceita vídeo e imagens no mesmo post.");
    }
    if (images.length > 10) {
      throw new PublishError("VALIDATION", "Instagram aceita no máximo 10 imagens por carrossel.");
    }
    const igUserId = account.externalId;
    const token = account.accessToken;

    let containerId: string;
    if (video) {
      containerId = await this.createContainer(igUserId, {
        media_type: "REELS",
        video_url: video,
        share_to_feed: "true",
        caption,
        access_token: token,
      });
    } else if (images.length === 1) {
      containerId = await this.createContainer(igUserId, { image_url: images[0], caption, access_token: token });
    } else {
      const children: string[] = [];
      for (const url of images) {
        children.push(await this.createContainer(igUserId, { image_url: url, is_carousel_item: "true", access_token: token }));
      }
      containerId = await this.createContainer(igUserId, {
        media_type: "CAROUSEL",
        children: children.join(","),
        caption,
        access_token: token,
      });
    }

    await this.waitUntilFinished(containerId, token, video ? POLL_MAX_ATTEMPTS_VIDEO : POLL_MAX_ATTEMPTS_IMAGE);

    const published = await this.postJson(`${GRAPH_BASE}/${igUserId}/media_publish`, {
      creation_id: containerId,
      access_token: token,
    });
    const mediaId = published.id;
    if (typeof mediaId !== "string") throw new PublishError("UNKNOWN", "media_publish não retornou id.");

    const permalink = await this.fetchPermalink(mediaId, token);
    return permalink ? { externalPostId: mediaId, externalUrl: permalink } : { externalPostId: mediaId };
  }

  /** Story: media_type=STORIES com uma imagem ou um vídeo; a API ignora legenda. */
  private async publishStory(input: PublishInput): Promise<PublishResult> {
    const { images, video } = splitMedia(input.media);
    if (input.media.length !== 1) throw new PublishError("VALIDATION", "Story exige exatamente uma imagem ou um vídeo.");
    const igUserId = input.account.externalId;
    const token = input.account.accessToken;
    const containerId = await this.createContainer(igUserId, {
      media_type: "STORIES",
      ...(video ? { video_url: video } : { image_url: images[0] }),
      access_token: token,
    });
    await this.waitUntilFinished(containerId, token, video ? POLL_MAX_ATTEMPTS_VIDEO : POLL_MAX_ATTEMPTS_IMAGE);
    const published = await this.postJson(`${GRAPH_BASE}/${igUserId}/media_publish`, { creation_id: containerId, access_token: token });
    const mediaId = published.id;
    if (typeof mediaId !== "string") throw new PublishError("UNKNOWN", "media_publish não retornou id.");
    return { externalPostId: mediaId };
  }

  private async createContainer(igUserId: string, fields: Record<string, string | undefined>): Promise<string> {
    const body = await this.postJson(`${GRAPH_BASE}/${igUserId}/media`, fields);
    const id = body.id;
    if (typeof id !== "string") throw new PublishError("UNKNOWN", "Criação do container não retornou id.");
    return id;
  }

  private async waitUntilFinished(containerId: string, token: string, maxAttempts: number): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      const url = `${GRAPH_BASE}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(token)}`;
      const res = await safeFetch(this.fetch, url);
      const body = (await readJson(res)) as Record<string, unknown> | undefined;
      if (!res.ok) throw mapMetaError(res.status, body);
      const status = body?.status_code;
      if (status === "FINISHED") return;
      if (status === "ERROR" || status === "EXPIRED") {
        throw new PublishError("MEDIA_REJECTED", `Instagram rejeitou a mídia (${String(body?.status ?? status)}).`);
      }
      await this.sleep(POLL_INTERVAL_MS);
    }
    throw new PublishError("UPSTREAM_UNAVAILABLE", "Instagram não processou a mídia a tempo.");
  }

  private async fetchPermalink(mediaId: string, token: string): Promise<string | undefined> {
    try {
      const url = `${GRAPH_BASE}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`;
      const res = await safeFetch(this.fetch, url);
      const body = (await readJson(res)) as Record<string, unknown> | undefined;
      return res.ok && typeof body?.permalink === "string" ? body.permalink : undefined;
    } catch {
      return undefined;
    }
  }

  private async postJson(url: string, fields: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    const res = await safeFetch(this.fetch, url, { method: "POST", body: formBody(fields) });
    const body = await readJson(res);
    if (!res.ok) throw mapMetaError(res.status, body);
    return (body ?? {}) as Record<string, unknown>;
  }
}

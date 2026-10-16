import type { Platform } from "@fsp/core";
import { GRAPH_BASE } from "./meta-config.js";
import { GBP_POSTS_BASE } from "./google-business.js";
import { TIKTOK_API } from "./oauth/tiktok.js";
import { mapTikTokError } from "./tiktok.js";
import { YOUTUBE_API } from "./youtube.js";
import { defaultFetch, mapGoogleError, mapMetaError, readJson, safeFetch } from "./http.js";
import type { AccountCredentials, ConnectorOptions, FetchLike } from "./types.js";

/** Publicação existente na plataforma (feita fora do sistema). */
export interface ExternalPostSummary {
  externalId: string;
  permalink?: string;
  caption: string;
  mediaType?: string;
  publishedAt: Date;
  likes: number;
  comments: number;
  shares: number;
}

export interface PostLister {
  readonly platform: Platform;
  /** Publicações a partir de `since`, mais recentes primeiro. */
  list(account: AccountCredentials, since: Date): Promise<ExternalPostSummary[]>;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const MAX_PAGES = 20;

async function metaGet(f: FetchLike, url: string): Promise<Record<string, unknown>> {
  const res = await safeFetch(f, url);
  const body = await readJson(res);
  if (!res.ok) throw mapMetaError(res.status, body);
  return (body ?? {}) as Record<string, unknown>;
}

/** Facebook Page: /{page-id}/posts com contagens por campo; paginação por `paging.next`. */
export class FacebookPostLister implements PostLister {
  readonly platform = "FACEBOOK_PAGE" as const;
  private readonly http;
  constructor(o: ConnectorOptions = {}) {
    this.http = o.fetch ?? defaultFetch;
  }
  async list(account: AccountCredentials, since: Date): Promise<ExternalPostSummary[]> {
    const fields = "id,message,created_time,permalink_url,shares,likes.summary(true).limit(0),comments.summary(true).limit(0),attachments{media_type}";
    let url: string | undefined = `${GRAPH_BASE}/${account.externalId}/posts?fields=${encodeURIComponent(fields)}&since=${Math.floor(since.getTime() / 1000)}&limit=100&access_token=${encodeURIComponent(account.accessToken)}`;
    const out: ExternalPostSummary[] = [];
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const body = await metaGet(this.http, url);
      for (const p of (body.data as Array<Record<string, unknown>> | undefined) ?? []) {
        const at = new Date(String(p.created_time));
        if (at < since) continue;
        const att = (p.attachments as { data?: Array<{ media_type?: string }> } | undefined)?.data?.[0];
        out.push({
          externalId: String(p.id),
          permalink: typeof p.permalink_url === "string" ? p.permalink_url : undefined,
          caption: typeof p.message === "string" ? p.message : "",
          mediaType: att?.media_type,
          publishedAt: at,
          likes: num((p.likes as { summary?: { total_count?: unknown } })?.summary?.total_count),
          comments: num((p.comments as { summary?: { total_count?: unknown } })?.summary?.total_count),
          shares: num((p.shares as { count?: unknown })?.count),
        } as ExternalPostSummary);
      }
      url = (body.paging as { next?: string } | undefined)?.next;
    }
    return out;
  }
}

/** Instagram: /{ig-user-id}/media com like_count/comments_count; para quando passar de `since`. */
export class InstagramPostLister implements PostLister {
  readonly platform = "INSTAGRAM" as const;
  private readonly http;
  constructor(o: ConnectorOptions = {}) {
    this.http = o.fetch ?? defaultFetch;
  }
  async list(account: AccountCredentials, since: Date): Promise<ExternalPostSummary[]> {
    const fields = "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count";
    let url: string | undefined = `${GRAPH_BASE}/${account.externalId}/media?fields=${fields}&limit=100&access_token=${encodeURIComponent(account.accessToken)}`;
    const out: ExternalPostSummary[] = [];
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const body = await metaGet(this.http, url);
      let older = false;
      for (const m of (body.data as Array<Record<string, unknown>> | undefined) ?? []) {
        const at = new Date(String(m.timestamp));
        if (at < since) { older = true; continue; }
        out.push({
          externalId: String(m.id),
          permalink: typeof m.permalink === "string" ? m.permalink : undefined,
          caption: typeof m.caption === "string" ? m.caption : "",
          mediaType: m.media_product_type === "REELS" ? "REELS" : typeof m.media_type === "string" ? m.media_type : undefined,
          publishedAt: at,
          likes: num(m.like_count),
          comments: num(m.comments_count),
          shares: 0,
        } as ExternalPostSummary);
      }
      url = older ? undefined : (body.paging as { next?: string } | undefined)?.next;
    }
    return out;
  }
}

/** Google Business Profile: /v4/{location}/localPosts (sem contagens; métricas vêm da coleta). */
export class GoogleBusinessPostLister implements PostLister {
  readonly platform = "GOOGLE_BUSINESS_PROFILE" as const;
  private readonly http;
  constructor(o: ConnectorOptions = {}) {
    this.http = o.fetch ?? defaultFetch;
  }
  async list(account: AccountCredentials, since: Date): Promise<ExternalPostSummary[]> {
    const out: ExternalPostSummary[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ pageSize: "100" });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await safeFetch(this.http, `${GBP_POSTS_BASE}/${account.externalId}/localPosts?${params}`, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
      });
      const body = (await readJson(res)) as Record<string, unknown> | undefined;
      if (!res.ok) throw mapGoogleError(res.status, body, res.headers.get("retry-after"));
      let older = false;
      for (const p of (body?.localPosts as Array<Record<string, unknown>> | undefined) ?? []) {
        const at = new Date(String(p.createTime));
        if (at < since) { older = true; continue; }
        out.push({
          externalId: String(p.name),
          permalink: typeof p.searchUrl === "string" ? p.searchUrl : undefined,
          caption: typeof p.summary === "string" ? p.summary : "",
          mediaType: typeof p.topicType === "string" ? p.topicType : undefined,
          publishedAt: at,
          likes: 0,
          comments: 0,
          shares: 0,
        } as ExternalPostSummary);
      }
      pageToken = older ? undefined : typeof body?.nextPageToken === "string" ? body.nextPageToken : undefined;
      if (!pageToken) break;
    }
    return out;
  }
}

export function createPostLister(platform: Platform, options: ConnectorOptions = {}): PostLister {
  switch (platform) {
    case "FACEBOOK_PAGE":
      return new FacebookPostLister(options);
    case "INSTAGRAM":
      return new InstagramPostLister(options);
    case "GOOGLE_BUSINESS_PROFILE":
      return new GoogleBusinessPostLister(options);
    case "TIKTOK":
      return new TikTokPostLister(options);
    case "YOUTUBE":
      return new YouTubePostLister(options);
  }
}

/** TikTok: /video/list (scope video.list), mais recentes primeiro, até `since`. */
export class TikTokPostLister implements PostLister {
  readonly platform = "TIKTOK" as const;
  private readonly fetch: FetchLike;
  constructor(options: ConnectorOptions = {}) {
    this.fetch = options.fetch ?? defaultFetch;
  }
  async list(account: AccountCredentials, since: Date): Promise<ExternalPostSummary[]> {
    const out: ExternalPostSummary[] = [];
    let cursor: number | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await safeFetch(this.fetch, `${TIKTOK_API}/video/list/?fields=id,title,create_time,share_url,like_count,comment_count,share_count,view_count`, {
        method: "POST",
        headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify({ max_count: 20, ...(cursor !== undefined ? { cursor } : {}) }),
      });
      const body = ((await readJson(res)) ?? {}) as { data?: { videos?: Array<Record<string, unknown>>; cursor?: number; has_more?: boolean }; error?: { code?: string } };
      if (!res.ok || (body.error?.code && body.error.code !== "ok")) throw mapTikTokError(res.status, body);
      let reachedSince = false;
      for (const v of body.data?.videos ?? []) {
        const publishedAt = new Date(num(v.create_time) * 1000);
        if (publishedAt < since) { reachedSince = true; continue; }
        out.push({
          externalId: String(v.id),
          ...(typeof v.share_url === "string" ? { permalink: v.share_url } : {}),
          caption: typeof v.title === "string" ? v.title : "",
          mediaType: "VIDEO",
          publishedAt,
          likes: num(v.like_count),
          comments: num(v.comment_count),
          shares: num(v.share_count),
        });
      }
      if (reachedSince || !body.data?.has_more) break;
      cursor = body.data.cursor;
    }
    return out;
  }
}

/** YouTube: playlist de uploads do canal + videos.list para estatísticas (3 unidades por página). */
export class YouTubePostLister implements PostLister {
  readonly platform = "YOUTUBE" as const;
  private readonly fetch: FetchLike;
  constructor(options: ConnectorOptions = {}) {
    this.fetch = options.fetch ?? defaultFetch;
  }
  private async get(url: string, token: string): Promise<Record<string, unknown>> {
    const res = await safeFetch(this.fetch, url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await readJson(res);
    if (!res.ok) throw mapGoogleError(res.status, body, res.headers.get("retry-after"));
    return (body ?? {}) as Record<string, unknown>;
  }
  async list(account: AccountCredentials, since: Date): Promise<ExternalPostSummary[]> {
    const token = account.accessToken;
    const ch = await this.get(`${YOUTUBE_API}/channels?part=contentDetails&mine=true`, token);
    const uploads = ((ch.items as Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }> | undefined)?.[0]?.contentDetails?.relatedPlaylists?.uploads) ?? "";
    if (!uploads) return [];
    const ids: string[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({ part: "contentDetails", playlistId: uploads, maxResults: "50" });
      if (pageToken) params.set("pageToken", pageToken);
      const body = await this.get(`${YOUTUBE_API}/playlistItems?${params}`, token);
      let reachedSince = false;
      for (const it of (body.items as Array<{ contentDetails?: { videoId?: string; videoPublishedAt?: string } }> | undefined) ?? []) {
        const at = new Date(it.contentDetails?.videoPublishedAt ?? 0);
        if (at < since) { reachedSince = true; continue; }
        if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
      }
      pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : undefined;
      if (reachedSince || !pageToken) break;
    }
    const out: ExternalPostSummary[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const body = await this.get(`${YOUTUBE_API}/videos?part=snippet,statistics&id=${ids.slice(i, i + 50).join(",")}`, token);
      for (const v of (body.items as Array<Record<string, unknown>> | undefined) ?? []) {
        const sn = (v.snippet ?? {}) as { title?: string; description?: string; publishedAt?: string };
        const st = (v.statistics ?? {}) as Record<string, unknown>;
        out.push({
          externalId: String(v.id),
          permalink: `https://youtu.be/${String(v.id)}`,
          caption: [sn.title, sn.description].filter(Boolean).join("\n"),
          mediaType: "VIDEO",
          publishedAt: new Date(sn.publishedAt ?? 0),
          likes: num(st.likeCount),
          comments: num(st.commentCount),
          shares: 0,
        });
      }
    }
    return out;
  }
}

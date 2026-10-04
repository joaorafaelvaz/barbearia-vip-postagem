import type { Platform } from "@fsp/core";
import { GRAPH_BASE } from "./facebook.js";
import { GBP_POSTS_BASE } from "./google-business.js";
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
  }
}

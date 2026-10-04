import { PublishError, type Platform } from "@fsp/core";
import { GRAPH_BASE } from "./facebook.js";
import { GBP_POSTS_BASE } from "./google-business.js";
import { defaultFetch, mapGoogleError, mapMetaError, readJson, safeFetch } from "./http.js";
import type { AccountCredentials, ConnectorOptions, FetchLike } from "./types.js";

/** Engajamento de uma publicação. Campos ausentes na plataforma ficam em 0 e `partial=true`. */
export interface PostMetrics {
  likes: number;
  comments: number;
  shares: number;
  reach: number;
  impressions: number;
  saves: number;
  clicks: number;
  /** alguma métrica não pôde ser lida (ex.: falta read_insights) */
  partial: boolean;
  note?: string;
}

export interface InsightsFetcher {
  readonly platform: Platform;
  fetch(account: AccountCredentials, externalPostId: string): Promise<PostMetrics>;
}

const empty = (): PostMetrics => ({ likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0, saves: 0, clicks: 0, partial: false });
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

async function metaGet(f: FetchLike, url: string): Promise<Record<string, unknown>> {
  const res = await safeFetch(f, url);
  const body = await readJson(res);
  if (!res.ok) throw mapMetaError(res.status, body);
  return (body ?? {}) as Record<string, unknown>;
}

/** Lê `/{id}/insights` e devolve {metric: valor}; erros de permissão viram `undefined` (parcial). */
async function metaInsights(f: FetchLike, id: string, metrics: string[], token: string): Promise<Record<string, number> | undefined> {
  try {
    const body = await metaGet(f, `${GRAPH_BASE}/${id}/insights?metric=${metrics.join(",")}&access_token=${encodeURIComponent(token)}`);
    const out: Record<string, number> = {};
    for (const row of (body.data as Array<Record<string, unknown>> | undefined) ?? []) {
      const values = row.values as Array<{ value: unknown }> | undefined;
      const v = values?.[0]?.value;
      out[String(row.name)] =
        typeof v === "object" && v !== null ? Object.values(v as Record<string, number>).reduce((a, b) => a + num(b), 0) : num(v);
    }
    return out;
  } catch (e) {
    if (e instanceof PublishError && (e.code === "PERMISSION_DENIED" || e.code === "VALIDATION")) return undefined;
    throw e;
  }
}

/** Facebook Page post: curtidas/comentários/compartilhamentos pelos campos; alcance e impressões por insights (read_insights). */
export class FacebookInsights implements InsightsFetcher {
  readonly platform = "FACEBOOK_PAGE" as const;
  private readonly http;
  constructor(o: ConnectorOptions = {}) {
    this.http = o.fetch ?? defaultFetch;
  }
  async fetch(account: AccountCredentials, postId: string): Promise<PostMetrics> {
    const m = empty();
    const token = account.accessToken;
    const fields = "likes.summary(true).limit(0),comments.summary(true).limit(0),shares";
    const body = await metaGet(this.http, `${GRAPH_BASE}/${postId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`);
    m.likes = num((body.likes as { summary?: { total_count?: unknown } })?.summary?.total_count);
    m.comments = num((body.comments as { summary?: { total_count?: unknown } })?.summary?.total_count);
    m.shares = num((body.shares as { count?: unknown })?.count);
    const ins = await metaInsights(this.http, postId, ["post_impressions", "post_impressions_unique", "post_clicks"], token);
    if (ins) {
      m.impressions = ins.post_impressions ?? 0;
      m.reach = ins.post_impressions_unique ?? 0;
      m.clicks = ins.post_clicks ?? 0;
    } else {
      m.partial = true;
      m.note = "Alcance e impressões exigem a permissão read_insights (reconecte a conta).";
    }
    return m;
  }
}

/** Instagram media: like_count/comments_count pelos campos; reach, impressions, saved por insights (instagram_manage_insights). */
export class InstagramInsights implements InsightsFetcher {
  readonly platform = "INSTAGRAM" as const;
  private readonly http;
  constructor(o: ConnectorOptions = {}) {
    this.http = o.fetch ?? defaultFetch;
  }
  async fetch(account: AccountCredentials, mediaId: string): Promise<PostMetrics> {
    const m = empty();
    const token = account.accessToken;
    const body = await metaGet(this.http, `${GRAPH_BASE}/${mediaId}?fields=like_count,comments_count,media_product_type&access_token=${encodeURIComponent(token)}`);
    m.likes = num(body.like_count);
    m.comments = num(body.comments_count);
    const reels = body.media_product_type === "REELS";
    const ins = await metaInsights(this.http, mediaId, reels ? ["reach", "saved", "shares", "plays"] : ["reach", "impressions", "saved", "shares"], token);
    if (ins) {
      m.reach = ins.reach ?? 0;
      m.impressions = ins.impressions ?? ins.plays ?? 0;
      m.saves = ins.saved ?? 0;
      m.shares = ins.shares ?? 0;
    } else {
      m.partial = true;
      m.note = "Alcance, impressões e salvamentos exigem instagram_manage_insights (reconecte a conta).";
    }
    return m;
  }
}

/** Google Business Profile: visualizações e cliques do post via localPosts:reportInsights (quando a API fornecer). */
export class GoogleBusinessInsights implements InsightsFetcher {
  readonly platform = "GOOGLE_BUSINESS_PROFILE" as const;
  private readonly http;
  constructor(o: ConnectorOptions = {}) {
    this.http = o.fetch ?? defaultFetch;
  }
  async fetch(account: AccountCredentials, postName: string): Promise<PostMetrics> {
    const m = empty();
    const end = new Date();
    const start = new Date(end.getTime() - 30 * 86_400_000);
    const res = await safeFetch(this.http, `${GBP_POSTS_BASE}/${account.externalId}/localPosts:reportInsights`, {
      method: "POST",
      headers: { Authorization: `Bearer ${account.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        localPostNames: [postName],
        basicRequest: {
          metricRequests: [{ metric: "LOCAL_POST_VIEWS_SEARCH" }, { metric: "LOCAL_POST_ACTIONS_CALL_TO_ACTION" }],
          timeRange: { startTime: start.toISOString(), endTime: end.toISOString() },
        },
      }),
    });
    const body = (await readJson(res)) as Record<string, unknown> | undefined;
    if (!res.ok) {
      const err = mapGoogleError(res.status, body, res.headers.get("retry-after"));
      if (err.code === "PERMISSION_DENIED" || err.code === "VALIDATION" || res.status === 404) {
        m.partial = true;
        m.note = "O Google não disponibiliza métricas para esta postagem.";
        return m;
      }
      throw err;
    }
    type Row = { metricValues?: Array<{ metric?: string; totalValue?: { value?: unknown } }> };
    const rows = (body?.localPostMetrics as Row[] | undefined) ?? [];
    for (const mv of rows[0]?.metricValues ?? []) {
      if (mv.metric === "LOCAL_POST_VIEWS_SEARCH") m.impressions = num(mv.totalValue?.value);
      if (mv.metric === "LOCAL_POST_ACTIONS_CALL_TO_ACTION") m.clicks = num(mv.totalValue?.value);
    }
    m.reach = m.impressions;
    return m;
  }
}

export function createInsightsFetcher(platform: Platform, options: ConnectorOptions = {}): InsightsFetcher {
  switch (platform) {
    case "FACEBOOK_PAGE":
      return new FacebookInsights(options);
    case "INSTAGRAM":
      return new InstagramInsights(options);
    case "GOOGLE_BUSINESS_PROFILE":
      return new GoogleBusinessInsights(options);
  }
}

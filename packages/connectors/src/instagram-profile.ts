import { PublishError } from "@fsp/core";
import { defaultFetch, formBody, mapMetaError, readJson, safeFetch } from "./http.js";
import { GRAPH_BASE } from "./meta-config.js";
import type { ConnectorOptions, FetchLike } from "./types.js";

/** Perfil de uma conta Instagram Business/Creator. */
export interface IgProfile {
  id: string;
  username: string;
  name?: string;
  profilePictureUrl?: string;
  biography?: string;
  website?: string;
  followersCount: number;
  followsCount: number;
  mediaCount: number;
}

export interface IgMediaItem {
  id: string;
  caption: string;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  permalink?: string;
  timestamp: string;
  likeCount: number;
  commentsCount: number;
}

export interface IgComment {
  id: string;
  text: string;
  username?: string;
  timestamp: string;
  likeCount: number;
  hidden: boolean;
  replies: IgComment[];
}

export interface IgMediaPage {
  items: IgMediaItem[];
  /** cursor para a próxima página; ausente na última */
  next?: string;
}

const PROFILE_FIELDS = "id,username,name,profile_picture_url,biography,website,followers_count,follows_count,media_count";
const MEDIA_FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
const REPLY_FIELDS = "id,text,username,timestamp,like_count,hidden";
const COMMENT_FIELDS = `${REPLY_FIELDS},replies{${REPLY_FIELDS}}`;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

async function call(f: FetchLike, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await safeFetch(f, url, init);
  const body = await readJson(res);
  if (!res.ok) throw mapMetaError(res.status, body);
  return (body ?? {}) as Record<string, unknown>;
}

function toComment(raw: Record<string, unknown>): IgComment {
  const replies = (raw.replies as { data?: Record<string, unknown>[] } | undefined)?.data ?? [];
  return {
    id: String(raw.id),
    text: typeof raw.text === "string" ? raw.text : "",
    username: str(raw.username),
    timestamp: String(raw.timestamp ?? ""),
    likeCount: num(raw.like_count),
    hidden: raw.hidden === true,
    replies: replies.map(toComment),
  };
}

/**
 * Gestão do perfil Instagram: perfil, mídias publicadas, exclusão de mídia e comentários.
 * Exige instagram_basic (perfil/mídias) e instagram_manage_comments (comentários).
 */
export class InstagramProfileClient {
  private readonly fetch: FetchLike;

  constructor(options: ConnectorOptions = {}) {
    this.fetch = options.fetch ?? defaultFetch;
  }

  async getProfile(igUserId: string, token: string): Promise<IgProfile> {
    const p = await call(this.fetch, `${GRAPH_BASE}/${igUserId}?fields=${PROFILE_FIELDS}&access_token=${encodeURIComponent(token)}`);
    return {
      id: String(p.id ?? igUserId),
      username: String(p.username ?? ""),
      name: str(p.name),
      profilePictureUrl: str(p.profile_picture_url),
      biography: str(p.biography),
      website: str(p.website),
      followersCount: num(p.followers_count),
      followsCount: num(p.follows_count),
      mediaCount: num(p.media_count),
    };
  }

  async listMedia(igUserId: string, token: string, after?: string, limit = 24): Promise<IgMediaPage> {
    const params = new URLSearchParams({ fields: MEDIA_FIELDS, limit: String(limit), access_token: token });
    if (after) params.set("after", after);
    const body = await call(this.fetch, `${GRAPH_BASE}/${igUserId}/media?${params.toString()}`);
    const data = (body.data as Record<string, unknown>[] | undefined) ?? [];
    const paging = body.paging as { next?: string; cursors?: { after?: string } } | undefined;
    const items: IgMediaItem[] = data.map((m) => ({
      id: String(m.id),
      caption: typeof m.caption === "string" ? m.caption : "",
      mediaType: String(m.media_type ?? "IMAGE"),
      mediaUrl: str(m.media_url),
      thumbnailUrl: str(m.thumbnail_url),
      permalink: str(m.permalink),
      timestamp: String(m.timestamp ?? ""),
      likeCount: num(m.like_count),
      commentsCount: num(m.comments_count),
    }));
    return { items, ...(paging?.next && paging.cursors?.after ? { next: paging.cursors.after } : {}) };
  }

  /** Exclui uma mídia (um carrossel é excluído inteiro). */
  async deleteMedia(mediaId: string, token: string): Promise<void> {
    const body = await call(this.fetch, `${GRAPH_BASE}/${mediaId}?access_token=${encodeURIComponent(token)}`, { method: "DELETE" });
    if (body.success === false) throw new PublishError("UNKNOWN", "O Instagram não confirmou a exclusão da mídia.");
  }

  async listComments(mediaId: string, token: string): Promise<IgComment[]> {
    const params = new URLSearchParams({ fields: COMMENT_FIELDS, limit: "50", access_token: token });
    const body = await call(this.fetch, `${GRAPH_BASE}/${mediaId}/comments?${params.toString()}`);
    return ((body.data as Record<string, unknown>[] | undefined) ?? []).map(toComment);
  }

  async replyToComment(commentId: string, token: string, message: string): Promise<{ id: string }> {
    const body = await call(this.fetch, `${GRAPH_BASE}/${commentId}/replies`, { method: "POST", body: formBody({ message, access_token: token }) });
    if (typeof body.id !== "string") throw new PublishError("UNKNOWN", "O Instagram não devolveu o id da resposta.");
    return { id: body.id };
  }

  async setCommentHidden(commentId: string, token: string, hidden: boolean): Promise<void> {
    await call(this.fetch, `${GRAPH_BASE}/${commentId}`, { method: "POST", body: formBody({ hide: hidden ? "true" : "false", access_token: token }) });
  }

  async deleteComment(commentId: string, token: string): Promise<void> {
    await call(this.fetch, `${GRAPH_BASE}/${commentId}?access_token=${encodeURIComponent(token)}`, { method: "DELETE" });
  }
}

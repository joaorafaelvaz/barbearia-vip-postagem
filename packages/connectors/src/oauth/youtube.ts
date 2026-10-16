import { defaultFetch, mapGoogleError, readJson, safeFetch } from "../http.js";
import type { FetchLike } from "../types.js";
import { buildGoogleAuthorizeUrl, type GoogleOAuthConfig } from "./google.js";

/** Upload de vídeos + leitura do canal/estatísticas. Mesmo client OAuth do Google, redirect próprio. */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const;

export interface YouTubeChannel {
  id: string;
  title: string;
  customUrl?: string;
  thumbnailUrl?: string;
}

export function buildYouTubeAuthorizeUrl(cfg: Pick<GoogleOAuthConfig, "clientId" | "redirectUri">, state: string): string {
  return buildGoogleAuthorizeUrl(cfg, state, YOUTUBE_SCOPES);
}

/** Canais do usuário autenticado (normalmente um). */
export async function listYouTubeChannels(accessToken: string, fetchImpl: FetchLike = defaultFetch): Promise<YouTubeChannel[]> {
  const res = await safeFetch(fetchImpl, "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await readJson(res)) as { items?: Array<Record<string, unknown>> } | undefined;
  if (!res.ok) throw mapGoogleError(res.status, body, res.headers.get("retry-after"));
  return (body?.items ?? []).map((it) => {
    const sn = (it.snippet ?? {}) as { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } };
    const ch: YouTubeChannel = { id: String(it.id), title: String(sn.title ?? "Canal") };
    if (sn.customUrl) ch.customUrl = sn.customUrl;
    if (sn.thumbnails?.default?.url) ch.thumbnailUrl = sn.thumbnails.default.url;
    return ch;
  });
}

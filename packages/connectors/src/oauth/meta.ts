import { GRAPH_BASE } from "../facebook.js";
import { defaultFetch, mapMetaError, readJson, safeFetch } from "../http.js";
import type { FetchLike } from "../types.js";

/**
 * Permissões necessárias para publicar em Pages e Instagram (sujeitas a App Review).
 * Vídeo em Página usa pages_manage_posts; publish_video não é aceito no Login para Empresas.
 */
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "read_insights",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "business_management",
] as const;

export interface MetaOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  fetch?: FetchLike;
}

export interface MetaPage {
  id: string;
  name: string;
  /** Page Access Token (de longa duração quando derivado de user token longo) */
  accessToken: string;
  instagramBusinessAccount?: { id: string; username?: string };
}

export function buildMetaAuthorizeUrl(cfg: Pick<MetaOAuthConfig, "appId" | "redirectUri">, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: cfg.redirectUri,
    state,
    response_type: "code",
    scope: META_SCOPES.join(","),
  });
  return `https://www.facebook.com/${GRAPH_BASE.split("/").pop()}/dialog/oauth?${params.toString()}`;
}

async function getJson(fetchImpl: FetchLike, url: string): Promise<Record<string, unknown>> {
  const res = await safeFetch(fetchImpl, url);
  const body = await readJson(res);
  if (!res.ok) throw mapMetaError(res.status, body);
  return (body ?? {}) as Record<string, unknown>;
}

/** Troca o `code` por um user access token de curta duração. */
export async function exchangeMetaCode(cfg: MetaOAuthConfig, code: string): Promise<string> {
  const f = cfg.fetch ?? defaultFetch;
  const params = new URLSearchParams({
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    redirect_uri: cfg.redirectUri,
    code,
  });
  const body = await getJson(f, `${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  return String(body.access_token);
}

/** Converte user token curto em longo (~60 dias). */
export async function exchangeForLongLivedToken(cfg: MetaOAuthConfig, shortToken: string): Promise<string> {
  const f = cfg.fetch ?? defaultFetch;
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: cfg.appId,
    client_secret: cfg.appSecret,
    fb_exchange_token: shortToken,
  });
  const body = await getJson(f, `${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  return String(body.access_token);
}

/**
 * Lista as Pages do usuário com seus Page Access Tokens e o Instagram Business Account
 * vinculado. Page tokens derivados de um user token longo não expiram.
 */
export async function listMetaPages(userToken: string, fetchImpl: FetchLike = defaultFetch): Promise<MetaPage[]> {
  const fields = "id,name,access_token,instagram_business_account{id,username}";
  const pages: MetaPage[] = [];
  let url: string | undefined =
    `${GRAPH_BASE}/me/accounts?fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(userToken)}`;
  while (url) {
    const body = await getJson(fetchImpl, url);
    const data = (body.data as Array<Record<string, unknown>> | undefined) ?? [];
    for (const p of data) {
      const ig = p.instagram_business_account as { id: string; username?: string } | undefined;
      const page: MetaPage = { id: String(p.id), name: String(p.name), accessToken: String(p.access_token) };
      if (ig?.id) page.instagramBusinessAccount = ig.username ? { id: ig.id, username: ig.username } : { id: ig.id };
      pages.push(page);
    }
    const paging = body.paging as { next?: string } | undefined;
    url = paging?.next;
  }
  return pages;
}

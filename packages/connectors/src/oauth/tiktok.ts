import { PublishError } from "@fsp/core";
import { defaultFetch, readJson, safeFetch } from "../http.js";
import type { FetchLike } from "../types.js";

/** Login Kit + Content Posting API (Direct Post) + listagem de vídeos (insights/importação). */
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish", "video.upload", "video.list"] as const;

export const TIKTOK_API = "https://open.tiktokapis.com/v2";
const AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";

export interface TikTokOAuthConfig {
  clientKey: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: FetchLike;
}

export interface TikTokTokens {
  accessToken: string;
  /** 24h */
  expiresAt: Date;
  refreshToken: string;
  /** 365 dias; a API pode devolver um refresh token novo a cada renovação */
  refreshExpiresAt: Date;
  openId: string;
  scope: string;
}

export interface TikTokUser {
  openId: string;
  displayName: string;
  avatarUrl?: string;
}

export function buildTikTokAuthorizeUrl(cfg: Pick<TikTokOAuthConfig, "clientKey" | "redirectUri">, state: string): string {
  const params = new URLSearchParams({
    client_key: cfg.clientKey,
    scope: TIKTOK_SCOPES.join(","),
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenBody {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(f: FetchLike, params: URLSearchParams, now: Date): Promise<TikTokTokens> {
  const res = await safeFetch(f, `${TIKTOK_API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const body = ((await readJson(res)) ?? {}) as TokenBody;
  if (!res.ok || body.error || !body.access_token) {
    const msg = body.error_description ?? body.error ?? `TikTok OAuth respondeu ${res.status}`;
    throw new PublishError(res.status === 401 || /invalid_grant|invalid_token/.test(body.error ?? "") ? "INVALID_TOKEN" : "UNKNOWN", msg, { upstreamStatus: res.status });
  }
  return {
    accessToken: body.access_token,
    expiresAt: new Date(now.getTime() + Number(body.expires_in ?? 86400) * 1000),
    refreshToken: String(body.refresh_token ?? ""),
    refreshExpiresAt: new Date(now.getTime() + Number(body.refresh_expires_in ?? 365 * 86400) * 1000),
    openId: String(body.open_id ?? ""),
    scope: String(body.scope ?? ""),
  };
}

export async function exchangeTikTokCode(cfg: TikTokOAuthConfig, code: string, now = new Date()): Promise<TikTokTokens> {
  return tokenRequest(cfg.fetch ?? defaultFetch, new URLSearchParams({
    client_key: cfg.clientKey,
    client_secret: cfg.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: cfg.redirectUri,
  }), now);
}

export async function refreshTikTokToken(cfg: TikTokOAuthConfig, refreshToken: string, now = new Date()): Promise<TikTokTokens> {
  const t = await tokenRequest(cfg.fetch ?? defaultFetch, new URLSearchParams({
    client_key: cfg.clientKey,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }), now);
  return { ...t, refreshToken: t.refreshToken || refreshToken };
}

/** Dados básicos do usuário autenticado (scope user.info.basic). */
export async function getTikTokUserInfo(accessToken: string, fetchImpl: FetchLike = defaultFetch): Promise<TikTokUser> {
  const res = await safeFetch(fetchImpl, `${TIKTOK_API}/user/info/?fields=open_id,union_id,avatar_url,display_name`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = ((await readJson(res)) ?? {}) as { data?: { user?: Record<string, unknown> }; error?: { code?: string; message?: string } };
  if (!res.ok || (body.error?.code && body.error.code !== "ok")) {
    throw new PublishError("INVALID_TOKEN", body.error?.message ?? `TikTok respondeu ${res.status}`, { upstreamStatus: res.status });
  }
  const u = body.data?.user ?? {};
  return {
    openId: String(u.open_id ?? ""),
    displayName: String(u.display_name ?? "TikTok"),
    ...(typeof u.avatar_url === "string" ? { avatarUrl: u.avatar_url } : {}),
  };
}

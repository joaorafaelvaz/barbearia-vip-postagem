import { defaultFetch, mapGoogleError, readJson, safeFetch } from "../http.js";
import type { FetchLike } from "../types.js";

export const GOOGLE_SCOPES = ["https://www.googleapis.com/auth/business.manage"] as const;

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const BUSINESS_INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch?: FetchLike;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

export interface GoogleLocation {
  /** `accounts/{a}/locations/{l}` (formato aceito pela API v4 de localPosts) */
  name: string;
  title: string;
  address?: string;
}

export function buildGoogleAuthorizeUrl(cfg: Pick<GoogleOAuthConfig, "clientId" | "redirectUri">, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function tokenRequest(f: FetchLike, params: URLSearchParams, now: Date): Promise<GoogleTokens> {
  const res = await safeFetch(f, TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const body = (await readJson(res)) as Record<string, unknown> | undefined;
  if (!res.ok) throw mapGoogleError(res.status, body, res.headers.get("retry-after"));
  const expiresIn = Number(body?.expires_in ?? 3600);
  const tokens: GoogleTokens = {
    accessToken: String(body?.access_token),
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
  };
  if (typeof body?.refresh_token === "string") tokens.refreshToken = body.refresh_token;
  return tokens;
}

export async function exchangeGoogleCode(cfg: GoogleOAuthConfig, code: string, now = new Date()): Promise<GoogleTokens> {
  return tokenRequest(
    cfg.fetch ?? defaultFetch,
    new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
    now,
  );
}

export async function refreshGoogleAccessToken(cfg: GoogleOAuthConfig, refreshToken: string, now = new Date()): Promise<GoogleTokens> {
  const tokens = await tokenRequest(
    cfg.fetch ?? defaultFetch,
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
    }),
    now,
  );
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}

async function getJson(f: FetchLike, url: string, accessToken: string): Promise<Record<string, unknown>> {
  const res = await safeFetch(f, url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await readJson(res);
  if (!res.ok) throw mapGoogleError(res.status, body, res.headers.get("retry-after"));
  return (body ?? {}) as Record<string, unknown>;
}

/** Lista todas as locations acessíveis pelo usuário, já no formato `accounts/{a}/locations/{l}`. */
export async function listGoogleLocations(accessToken: string, fetchImpl: FetchLike = defaultFetch): Promise<GoogleLocation[]> {
  const accountsBody = await getJson(fetchImpl, `${ACCOUNTS_API}/accounts`, accessToken);
  const accounts = (accountsBody.accounts as Array<{ name: string }> | undefined) ?? [];
  const result: GoogleLocation[] = [];
  for (const account of accounts) {
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ readMask: "name,title,storefrontAddress", pageSize: "100" });
      if (pageToken) params.set("pageToken", pageToken);
      const body = await getJson(fetchImpl, `${BUSINESS_INFO_API}/${account.name}/locations?${params}`, accessToken);
      const locations = (body.locations as Array<Record<string, unknown>> | undefined) ?? [];
      for (const loc of locations) {
        const locId = String(loc.name).split("/").pop();
        const addr = loc.storefrontAddress as { locality?: string; addressLines?: string[] } | undefined;
        const entry: GoogleLocation = { name: `${account.name}/locations/${locId}`, title: String(loc.title ?? "") };
        const addressText = [addr?.addressLines?.join(", "), addr?.locality].filter(Boolean).join(" - ");
        if (addressText) entry.address = addressText;
        result.push(entry);
      }
      pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : undefined;
    } while (pageToken);
  }
  return result;
}

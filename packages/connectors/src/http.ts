import { PublishError, type PublishErrorCode } from "@fsp/core";
import type { FetchLike } from "./types.js";

export const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface MetaErrorBody {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
}

/**
 * Mapeia erros da Graph API (Meta) para PublishError.
 * Códigos: https://developers.facebook.com/docs/graph-api/guides/error-handling
 */
export function mapMetaError(status: number, body: unknown): PublishError {
  const err = (body as MetaErrorBody | undefined)?.error;
  const code = err?.code;
  const message = err?.message ?? `Graph API respondeu ${status}`;
  let kind: PublishErrorCode = "UNKNOWN";
  if (code === 190 || code === 102) kind = "INVALID_TOKEN";
  else if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80001 || status === 429) kind = "RATE_LIMITED";
  else if (code === 10 || (code !== undefined && code >= 200 && code <= 299)) kind = "PERMISSION_DENIED";
  else if (code === 9004 || code === 9007 || code === 36000 || code === 36001 || code === 36003) kind = "MEDIA_REJECTED";
  else if (code === 100) kind = "VALIDATION";
  else if (status >= 500) kind = "UPSTREAM_UNAVAILABLE";
  return new PublishError(kind, message, { upstreamStatus: status });
}

interface GoogleErrorBody {
  error?: { message?: string; status?: string; code?: number; details?: unknown[] };
}

/** Mapeia erros das APIs Google para PublishError. */
export function mapGoogleError(status: number, body: unknown, retryAfterHeader?: string | null): PublishError {
  const err = (body as GoogleErrorBody | undefined)?.error;
  const message = err?.message ?? `Google API respondeu ${status}`;
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) || undefined : undefined;
  let kind: PublishErrorCode = "UNKNOWN";
  if (status === 401) kind = "INVALID_TOKEN";
  else if (status === 429 || err?.status === "RESOURCE_EXHAUSTED") kind = "RATE_LIMITED";
  else if (status === 403) kind = "PERMISSION_DENIED";
  else if (status === 400) kind = /media|image|photo/i.test(message) ? "MEDIA_REJECTED" : "VALIDATION";
  else if (status >= 500) kind = "UPSTREAM_UNAVAILABLE";
  const opts: { upstreamStatus: number; retryAfterSeconds?: number } = { upstreamStatus: status };
  if (retryAfterSeconds !== undefined) opts.retryAfterSeconds = retryAfterSeconds;
  return new PublishError(kind, message, opts);
}

export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

/** Wrapper de fetch que converte falhas de rede em PublishError NETWORK. */
export async function safeFetch(fetchImpl: FetchLike, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch (cause) {
    throw new PublishError("NETWORK", "Falha de rede ao chamar a API.", { cause });
  }
}

export function formBody(fields: Record<string, string | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) params.set(k, v);
  return params;
}

import type { FetchLike } from "../types.js";

export interface Recorded {
  url: string;
  method: string;
  body: Record<string, string> | unknown;
  headers: Record<string, string>;
}

type Handler = (req: Recorded) => { status?: number; json?: unknown; headers?: Record<string, string> };

/** Cria um fetch falso que responde na ordem dos handlers e grava as requisições. */
export function fakeFetch(handlers: Handler[]): { fetch: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    const h = init?.headers as Record<string, string> | undefined;
    if (h) Object.assign(headers, h);
    let body: Recorded["body"] = undefined;
    if (init?.body instanceof URLSearchParams) body = Object.fromEntries(init.body.entries());
    else if (typeof init?.body === "string") body = JSON.parse(init.body);
    const rec: Recorded = { url, method: init?.method ?? "GET", body, headers };
    calls.push(rec);
    const handler = handlers[i++];
    if (!handler) throw new Error(`fakeFetch: requisição inesperada ${rec.method} ${url}`);
    const out = handler(rec);
    return new Response(out.json === undefined ? "" : JSON.stringify(out.json), {
      status: out.status ?? 200,
      headers: { "content-type": "application/json", ...(out.headers ?? {}) },
    });
  };
  return { fetch, calls };
}

export const account = {
  fb: { platform: "FACEBOOK_PAGE" as const, externalId: "page123", accessToken: "PAGE_TOKEN_SECRET" },
  ig: { platform: "INSTAGRAM" as const, externalId: "ig456", accessToken: "PAGE_TOKEN_SECRET" },
  gbp: {
    platform: "GOOGLE_BUSINESS_PROFILE" as const,
    externalId: "accounts/1/locations/2",
    accessToken: "GOOGLE_ACCESS_SECRET",
  },
};

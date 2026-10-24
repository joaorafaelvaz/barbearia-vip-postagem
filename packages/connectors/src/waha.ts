import { defaultFetch, defaultSleep } from "./http.js";
import type { FetchLike } from "./types.js";

export interface WahaConfig {
  /** ex.: http://127.0.0.1:3000 (sem /api) */
  baseUrl: string;
  apiKey?: string | undefined;
  /** nome da sessão WAHA (padrão "default") */
  session: string;
}

/** Resultado de um envio: nunca lança; `error` curto e sem segredos (vai para WhatsappDelivery.error / log). */
export type WahaSendResult = { ok: true } | { ok: false; error: string };

export interface WahaSenderLike {
  sendText(chatId: string, text: string): Promise<WahaSendResult>;
}

const TIMEOUT_MS = 15_000;
const RETRY_WAIT_MS = 3_000;
const ATTEMPTS = 2;
const ERROR_BODY_MAX = 200;

/**
 * Cliente mínimo do WAHA (WhatsApp HTTP API), porta de daily/senders/waha.py:
 * POST {WAHA_URL}/api/sendText {session, chatId, text}, header X-Api-Key.
 * `sendText` NUNCA lança: devolve `{ ok: false, error }` após 2 tentativas (3 s entre elas),
 * com o status HTTP e o começo do corpo na mensagem ("WAHA 401: ...") para diagnóstico.
 */
export class WahaClient implements WahaSenderLike {
  readonly session: string;
  private readonly fetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly url: string;
  private readonly apiKey: string | undefined;

  constructor(cfg: WahaConfig, options: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void> } = {}) {
    this.url = `${cfg.baseUrl.replace(/\/+$/, "")}/api/sendText`;
    this.apiKey = cfg.apiKey || undefined;
    this.session = cfg.session;
    this.fetch = options.fetch ?? defaultFetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** null quando WAHA_URL não está configurada (envio desabilitado). */
  static fromEnv(env: Record<string, string | undefined> = process.env): WahaClient | null {
    if (!env.WAHA_URL) return null;
    return new WahaClient({ baseUrl: env.WAHA_URL, apiKey: env.WAHA_API_KEY, session: env.WAHA_SESSION || "default" });
  }

  async sendText(chatId: string, text: string): Promise<WahaSendResult> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["X-Api-Key"] = this.apiKey;
    const body = JSON.stringify({ session: this.session, chatId, text });
    let error = "WAHA: sem resposta";
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        const res = await this.fetch(this.url, { method: "POST", headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (res.ok) return { ok: true };
        const detail = (await res.text().catch(() => "")).slice(0, ERROR_BODY_MAX);
        error = detail ? `WAHA ${res.status}: ${detail}` : `WAHA ${res.status}`;
      } catch (err) {
        // rede/timeout: tenta de novo
        error = `WAHA: ${err instanceof Error ? err.message : String(err)}`;
      }
      if (attempt < ATTEMPTS) await this.sleep(RETRY_WAIT_MS);
    }
    return { ok: false, error };
  }
}

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { HttpError } from "../api";
import { AVISO_WHATSAPP_SYSTEM_PROMPT } from "../prompts/aviso-whatsapp";

export const AI_MODEL = "claude-opus-5-5";
export const TONES = ["Amigável", "Formal", "Urgente"] as const;

/** Resposta mínima que o serviço lê (subconjunto de `BetaMessage`). */
export interface NoticeAiResponse {
  stop_reason: string | null;
  content: Array<{ type: string; text?: string }>;
}

/** Cliente injetável: em produção adapta `client.beta.messages.create`; nos testes, um fake (nunca chama a API real). */
export interface NoticeAiClient {
  create(params: Record<string, unknown>, options: { timeout: number; maxRetries: number }): Promise<NoticeAiResponse>;
}

export function anthropicNoticeClient(apiKey: string): NoticeAiClient {
  const client = new Anthropic({ apiKey });
  return {
    // Os parâmetros beta (`fallbacks`, `output_config.effort`) variam entre versões do SDK; o cast evita quebrar o typecheck.
    create: (params, options) => client.beta.messages.create(params as never, options) as unknown as Promise<NoticeAiResponse>,
  };
}

const inputSchema = z.object({ assunto: z.string().max(500).default(""), tom: z.string().max(40).default(TONES[0]) });

/**
 * Gera o texto do aviso (porta de daily/admin/ia.py): claude-opus-5-5, effort low, 1024 tokens,
 * fallback de recusa do lado do servidor, timeout 30 s, 1 retentativa. O texto NUNCA é agendado
 * automaticamente: volta para a caixa de texto, editável.
 */
export async function generateNoticeText(deps: { apiKey: string | undefined; client?: NoticeAiClient }, raw: unknown): Promise<string> {
  if (!deps.apiKey) throw new HttpError(503, "IA não configurada (ANTHROPIC_API_KEY).");
  const input = inputSchema.parse(raw);
  const assunto = input.assunto.trim();
  if (!assunto) throw new HttpError(400, "Informe o assunto.");
  const tom = (TONES as readonly string[]).includes(input.tom) ? input.tom : TONES[0];
  const client = deps.client ?? anthropicNoticeClient(deps.apiKey);
  let resp: NoticeAiResponse;
  try {
    resp = await client.create(
      {
        model: AI_MODEL,
        max_tokens: 1024,
        output_config: { effort: "low" },
        system: AVISO_WHATSAPP_SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Assunto: ${assunto}\nTom: ${tom}` }],
        // Recusa do classificador de segurança -> a API refaz a chamada noutro modelo
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { timeout: 30_000, maxRetries: 1 },
    );
  } catch (err) {
    // Da classe mais específica para a mais genérica, como no Python. Nunca loga a chave.
    if (err instanceof Anthropic.AuthenticationError) throw new HttpError(400, "Chave da Anthropic inválida. Confira ANTHROPIC_API_KEY.");
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, "Limite de uso da IA atingido. Tente de novo em instantes.");
    if (err instanceof Anthropic.APIConnectionTimeoutError || err instanceof Anthropic.APIConnectionError) throw new HttpError(504, "Sem resposta da IA (tempo esgotado). Tente de novo.");
    if (err instanceof Anthropic.APIError) {
      console.error("[ia] Anthropic status", err.status, err.message);
      if ((err.status ?? 500) >= 500) throw new HttpError(503, "Serviço de IA indisponível no momento.");
      throw new HttpError(400, `Erro da IA: ${err.message}`);
    }
    throw err;
  }
  if (resp.stop_reason === "refusal") throw new HttpError(400, "A IA não conseguiu gerar uma mensagem para esse assunto. Reformule o pedido.");
  const text = resp.content.find((b) => b.type === "text")?.text?.trim() ?? "";
  if (!text) throw new HttpError(400, "A IA retornou vazio. Tente de novo.");
  return text;
}

import { describe, expect, it } from "vitest";
import { generateNoticeText, type NoticeAiClient } from "./whatsapp-ai";

function fakeClient(resp: { stop_reason: string | null; content: Array<{ type: string; text?: string }> }, seen: Record<string, unknown>[] = []): NoticeAiClient {
  return { async create(params, options) { seen.push({ ...params, options }); return resp; } };
}

describe("generateNoticeText", () => {
  it("sem chave -> 503", async () => {
    await expect(generateNoticeText({ apiKey: undefined, client: fakeClient({ stop_reason: "end_turn", content: [] }) }, { assunto: "x", tom: "Formal" })).rejects.toMatchObject({ status: 503 });
  });
  it("chama a API com os parâmetros do daily e devolve o texto trimado", async () => {
    const seen: Record<string, unknown>[] = [];
    const text = await generateNoticeText({ apiKey: "k", client: fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "  Olá *time*! Lembrete.  " }] }, seen) }, { assunto: "lembrete de caixa", tom: "Formal" });
    expect(text).toBe("Olá *time*! Lembrete.");
    expect(seen[0]).toMatchObject({ model: "claude-opus-5-5", max_tokens: 1024, output_config: { effort: "low" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", options: { timeout: 30_000, maxRetries: 1 } });
    expect((seen[0]?.messages as Array<{ content: string }>)[0]?.content).toBe("Assunto: lembrete de caixa\nTom: Formal");
    expect(String(seen[0]?.system)).toContain("Barbearia VIP");
  });
  it("recusa vira erro amigável; assunto vazio e tom desconhecido", async () => {
    await expect(generateNoticeText({ apiKey: "k", client: fakeClient({ stop_reason: "refusal", content: [] }) }, { assunto: "x", tom: "Amigável" })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("não conseguiu") });
    await expect(generateNoticeText({ apiKey: "k", client: fakeClient({ stop_reason: "end_turn", content: [] }) }, { assunto: "  ", tom: "Amigável" })).rejects.toMatchObject({ status: 400, message: "Informe o assunto." });
    const seen: Record<string, unknown>[] = [];
    await generateNoticeText({ apiKey: "k", client: fakeClient({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }, seen) }, { assunto: "x", tom: "Sarcástico" });
    expect((seen[0]?.messages as Array<{ content: string }>)[0]?.content).toContain("Tom: Amigável");
  });
  it("resposta sem bloco de texto -> 400 'retornou vazio'", async () => {
    await expect(generateNoticeText({ apiKey: "k", client: fakeClient({ stop_reason: "end_turn", content: [{ type: "thinking" }] }) }, { assunto: "x", tom: "Formal" })).rejects.toMatchObject({ status: 400, message: expect.stringContaining("vazio") });
  });
  it("erros do SDK viram HttpError amigável (autenticação 400, rate limit 429, 5xx -> 503, 4xx -> 400, rede/timeout -> 504)", async () => {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const throwing = (err: unknown): NoticeAiClient => ({ async create() { throw err; } });
    const call = (err: unknown) => generateNoticeText({ apiKey: "k", client: throwing(err) }, { assunto: "x", tom: "Formal" });
    const headers = new Headers();
    await expect(call(new Anthropic.AuthenticationError(401, { error: {} }, "bad key", headers))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("Chave") });
    await expect(call(new Anthropic.RateLimitError(429, { error: {} }, "slow down", headers))).rejects.toMatchObject({ status: 429 });
    await expect(call(new Anthropic.InternalServerError(500, { error: {} }, "boom", headers))).rejects.toMatchObject({ status: 503, message: expect.stringContaining("indisponível") });
    // O SDK monta `message` a partir do corpo do erro (`error.message`), não do 3º argumento.
    await expect(call(new Anthropic.BadRequestError(400, { error: { message: "model not found" } }, undefined, headers))).rejects.toMatchObject({ status: 400, message: expect.stringContaining("model not found") });
    await expect(call(new Anthropic.APIConnectionTimeoutError({ message: "timed out" }))).rejects.toMatchObject({ status: 504 });
    await expect(call(new Anthropic.APIConnectionError({ message: "ECONNRESET" }))).rejects.toMatchObject({ status: 504 });
    await expect(call(new Error("outra coisa"))).rejects.toThrow("outra coisa");
  });
});

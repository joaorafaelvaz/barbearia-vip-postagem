import { describe, expect, it } from "vitest";
import { WahaClient } from "../waha.js";
import { fakeFetch } from "./helpers.js";

const cfg = { baseUrl: "http://waha:3000/", apiKey: "K", session: "default" };
const noSleep = async () => {};

describe("WahaClient.sendText", () => {
  it("POST /api/sendText com session/chatId/text e X-Api-Key; true em 2xx", async () => {
    const { fetch, calls } = fakeFetch([() => ({ json: { id: "msg1" } })]);
    const out = await new WahaClient(cfg, { fetch, sleep: noSleep }).sendText("a@g.us", "Olá *time*");
    expect(out).toEqual({ ok: true });
    expect(calls[0]?.url).toBe("http://waha:3000/api/sendText");
    expect(calls[0]?.headers["X-Api-Key"]).toBe("K");
    expect(calls[0]?.body).toEqual({ session: "default", chatId: "a@g.us", text: "Olá *time*" });
  });
  it("sem apiKey não manda o header", async () => {
    const { fetch, calls } = fakeFetch([() => ({ json: {} })]);
    await new WahaClient({ ...cfg, apiKey: undefined }, { fetch, sleep: noSleep }).sendText("a@g.us", "x");
    expect(calls[0]?.headers["X-Api-Key"]).toBeUndefined();
  });
  it("falha nas 2 tentativas devolve ok=false com o último erro, sem lançar (HTTP 500 e depois rede)", async () => {
    const { fetch, calls } = fakeFetch([() => ({ status: 500, json: { error: "x" } }), () => { throw new TypeError("fetch failed"); }]);
    const out = await new WahaClient(cfg, { fetch, sleep: noSleep }).sendText("a@g.us", "x");
    expect(out).toEqual({ ok: false, error: "WAHA: fetch failed" });
    expect(calls).toHaveLength(2);
  });
  it("erro HTTP traz o status e o corpo (truncado) na mensagem", async () => {
    const { fetch } = fakeFetch([() => ({ status: 401, json: { message: "Unauthorized" } }), () => ({ status: 401, json: { message: "Unauthorized" } })]);
    const out = await new WahaClient(cfg, { fetch, sleep: noSleep }).sendText("a@g.us", "x");
    expect(out).toEqual({ ok: false, error: 'WAHA 401: {"message":"Unauthorized"}' });
  });
  it("2a tentativa salva o envio", async () => {
    const { fetch } = fakeFetch([() => ({ status: 503 }), () => ({ json: {} })]);
    expect(await new WahaClient(cfg, { fetch, sleep: noSleep }).sendText("a@g.us", "x")).toEqual({ ok: true });
  });
  it("fromEnv exige WAHA_URL", () => {
    expect(WahaClient.fromEnv({})).toBeNull();
    expect(WahaClient.fromEnv({ WAHA_URL: "http://w", WAHA_SESSION: "s1" })?.session).toBe("s1");
  });
});

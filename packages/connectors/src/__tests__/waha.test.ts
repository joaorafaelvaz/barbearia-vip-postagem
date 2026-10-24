import { describe, expect, it } from "vitest";
import { WahaClient } from "../waha.js";
import { fakeFetch } from "./helpers.js";

const cfg = { baseUrl: "http://waha:3000/", apiKey: "K", session: "default" };
const noSleep = async () => {};

describe("WahaClient.sendText", () => {
  it("POST /api/sendText com session/chatId/text e X-Api-Key; true em 2xx", async () => {
    const { fetch, calls } = fakeFetch([() => ({ json: { id: "msg1" } })]);
    const ok = await new WahaClient(cfg, { fetch, sleep: noSleep }).sendText("a@g.us", "Olá *time*");
    expect(ok).toBe(true);
    expect(calls[0]?.url).toBe("http://waha:3000/api/sendText");
    expect(calls[0]?.headers["X-Api-Key"]).toBe("K");
    expect(calls[0]?.body).toEqual({ session: "default", chatId: "a@g.us", text: "Olá *time*" });
  });
  it("sem apiKey não manda o header", async () => {
    const { fetch, calls } = fakeFetch([() => ({ json: {} })]);
    await new WahaClient({ ...cfg, apiKey: undefined }, { fetch, sleep: noSleep }).sendText("a@g.us", "x");
    expect(calls[0]?.headers["X-Api-Key"]).toBeUndefined();
  });
  it("falha nas 2 tentativas devolve false sem lançar (HTTP 500 e depois rede)", async () => {
    const { fetch, calls } = fakeFetch([() => ({ status: 500, json: { error: "x" } }), () => { throw new TypeError("fetch failed"); }]);
    const ok = await new WahaClient(cfg, { fetch, sleep: noSleep }).sendText("a@g.us", "x");
    expect(ok).toBe(false);
    expect(calls).toHaveLength(2);
  });
  it("2a tentativa salva o envio", async () => {
    const { fetch } = fakeFetch([() => ({ status: 503 }), () => ({ json: {} })]);
    expect(await new WahaClient(cfg, { fetch, sleep: noSleep }).sendText("a@g.us", "x")).toBe(true);
  });
  it("fromEnv exige WAHA_URL", () => {
    expect(WahaClient.fromEnv({})).toBeNull();
    expect(WahaClient.fromEnv({ WAHA_URL: "http://w", WAHA_SESSION: "s1" })?.session).toBe("s1");
  });
});

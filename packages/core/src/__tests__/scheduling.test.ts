import { describe, expect, it } from "vitest";
import { backoffMs, delayUntil, publishJobId } from "../scheduling.js";

describe("scheduling", () => {
  it("jobId é determinístico por target", () => {
    expect(publishJobId("abc")).toBe("post-target-abc");
    expect(publishJobId("abc")).toBe(publishJobId("abc"));
  });

  it("delayUntil nunca é negativo", () => {
    const now = new Date("2026-10-03T12:00:00Z");
    expect(delayUntil(new Date("2026-10-03T12:00:30Z"), now)).toBe(30_000);
    expect(delayUntil(new Date("2026-10-03T11:00:00Z"), now)).toBe(0);
  });

  it("backoff exponencial com teto de 30 minutos e respeita retry-after", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
    expect(backoffMs(20)).toBe(30 * 60_000);
    expect(backoffMs(1, 600)).toBe(600_000);
  });
});

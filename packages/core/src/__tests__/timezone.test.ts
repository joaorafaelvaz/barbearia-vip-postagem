import { describe, expect, it } from "vitest";
import { isValidTimeZone, localToUtc, utcToLocal } from "../timezone.js";

describe("timezone", () => {
  it("converte horário local de São Paulo (UTC-3) para UTC", () => {
    const d = localToUtc("2026-10-15T09:30", "America/Sao_Paulo");
    expect(d.toISOString()).toBe("2026-10-15T12:30:00.000Z");
  });

  it("converte horário local de Manaus (UTC-4) para UTC", () => {
    const d = localToUtc("2026-10-15T09:30", "America/Manaus");
    expect(d.toISOString()).toBe("2026-10-15T13:30:00.000Z");
  });

  it("lida com horário de verão (New York, DST em julho = UTC-4, janeiro = UTC-5)", () => {
    expect(localToUtc("2026-07-01T12:00", "America/New_York").toISOString()).toBe("2026-07-01T16:00:00.000Z");
    expect(localToUtc("2026-01-01T12:00", "America/New_York").toISOString()).toBe("2026-01-01T17:00:00.000Z");
  });

  it("transição de DST: 2026-03-08 03:00 em New York (logo após o salto) resolve corretamente", () => {
    // Às 02:00 locais o relógio pula para 03:00; 03:00 local = 07:00Z (já em EDT).
    expect(localToUtc("2026-03-08T03:00", "America/New_York").toISOString()).toBe("2026-03-08T07:00:00.000Z");
  });

  it("utcToLocal é inverso de localToUtc", () => {
    const local = "2026-12-24T18:45";
    const tz = "America/Sao_Paulo";
    expect(utcToLocal(localToUtc(local, tz), tz)).toBe(local);
  });

  it("rejeita fuso e formato inválidos", () => {
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(() => localToUtc("2026-10-15T09:30", "Mars/Olympus")).toThrow(/Fuso/);
    expect(() => localToUtc("15/10/2026 09:30", "America/Sao_Paulo")).toThrow(/inválido/);
  });
});

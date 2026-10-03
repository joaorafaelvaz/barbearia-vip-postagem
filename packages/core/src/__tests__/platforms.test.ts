import { describe, expect, it } from "vitest";
import { validateCaption } from "../platforms.js";
import { validateImage } from "../media.js";

describe("validateCaption", () => {
  it("aceita texto curto com mídia em todas as plataformas", () => {
    expect(validateCaption("Promoção de corte!", ["FACEBOOK_PAGE", "INSTAGRAM", "GOOGLE_BUSINESS_PROFILE"], true)).toEqual([]);
  });

  it("Instagram exige mídia", () => {
    const issues = validateCaption("Texto", ["INSTAGRAM", "FACEBOOK_PAGE"], false);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.platform).toBe("INSTAGRAM");
  });

  it("aplica limite de caracteres por plataforma", () => {
    const long = "a".repeat(1_600);
    const issues = validateCaption(long, ["GOOGLE_BUSINESS_PROFILE", "INSTAGRAM", "FACEBOOK_PAGE"], true);
    expect(issues.map((i) => i.platform)).toEqual(["GOOGLE_BUSINESS_PROFILE"]);
  });

  it("post sem texto e sem mídia é inválido", () => {
    expect(validateCaption("   ", ["FACEBOOK_PAGE"], false).length).toBeGreaterThan(0);
  });
});

describe("validateImage", () => {
  const ok = { mimeType: "image/jpeg", width: 1080, height: 1350, bytes: 900_000 };

  it("imagem 4:5 JPEG passa em todas", () => {
    expect(validateImage(ok, ["FACEBOOK_PAGE", "INSTAGRAM", "GOOGLE_BUSINESS_PROFILE"])).toEqual([]);
  });

  it("PNG falha só no Instagram", () => {
    const issues = validateImage({ ...ok, mimeType: "image/png" }, ["FACEBOOK_PAGE", "INSTAGRAM", "GOOGLE_BUSINESS_PROFILE"]);
    expect(issues.map((i) => i.platform)).toEqual(["INSTAGRAM"]);
  });

  it("proporção muito alta (9:16) falha no Instagram", () => {
    const issues = validateImage({ ...ok, width: 1080, height: 1920 }, ["INSTAGRAM"]);
    expect(issues.some((i) => /proporção/.test(i.message))).toBe(true);
  });

  it("imagem pequena falha no GBP", () => {
    const issues = validateImage({ ...ok, width: 200, height: 200 }, ["GOOGLE_BUSINESS_PROFILE"]);
    expect(issues.some((i) => /250x250/.test(i.message))).toBe(true);
  });
});

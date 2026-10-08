import { describe, expect, it } from "vitest";
import { planStorySegments, validateCaption, validateFormat } from "../platforms.js";
import { validateImage, validateMediaSet, validateVideo } from "../media.js";

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
  const ok = { kind: "IMAGE" as const, mimeType: "image/jpeg", width: 1080, height: 1350, bytes: 900_000 };

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

describe("validateVideo", () => {
  const reel = { kind: "VIDEO" as const, mimeType: "video/mp4", width: 1080, height: 1920, bytes: 50_000_000, durationSec: 30 };

  it("MP4 vertical de 30s passa no Instagram e no Facebook", () => {
    expect(validateVideo(reel, ["INSTAGRAM", "FACEBOOK_PAGE"])).toEqual([]);
  });

  it("Google Business Profile não aceita vídeo", () => {
    const issues = validateVideo(reel, ["GOOGLE_BUSINESS_PROFILE"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toMatch(/não aceita vídeo/);
  });

  it("vídeo de 1s falha no Instagram (mínimo 3s) mas passa no Facebook", () => {
    const issues = validateVideo({ ...reel, durationSec: 1 }, ["INSTAGRAM", "FACEBOOK_PAGE"]);
    expect(issues.map((i) => i.platform)).toEqual(["INSTAGRAM"]);
  });

  it("formato não suportado (webm) falha", () => {
    const issues = validateVideo({ ...reel, mimeType: "video/webm" }, ["FACEBOOK_PAGE"]);
    expect(issues[0]?.message).toMatch(/MP4, MOV/);
  });
});

describe("validateMediaSet", () => {
  it("só imagens é sempre válido", () => {
    expect(validateMediaSet(["IMAGE", "IMAGE"], ["INSTAGRAM", "GOOGLE_BUSINESS_PROFILE"])).toEqual([]);
  });

  it("um vídeo é válido para Instagram e Facebook", () => {
    expect(validateMediaSet(["VIDEO"], ["INSTAGRAM", "FACEBOOK_PAGE"])).toEqual([]);
  });

  it("vídeo com conta do Google selecionada é bloqueado", () => {
    const issues = validateMediaSet(["VIDEO"], ["INSTAGRAM", "GOOGLE_BUSINESS_PROFILE"]);
    expect(issues.map((i) => i.platform)).toEqual(["GOOGLE_BUSINESS_PROFILE"]);
  });

  it("dois vídeos ou vídeo misturado com imagem é bloqueado", () => {
    expect(validateMediaSet(["VIDEO", "VIDEO"], ["INSTAGRAM"]).length).toBe(1);
    expect(validateMediaSet(["VIDEO", "IMAGE"], ["FACEBOOK_PAGE"]).length).toBe(1);
  });
});

describe("validateFormat", () => {
  it("Feed não impõe regras extras", () => {
    expect(validateFormat("FEED", ["GOOGLE_BUSINESS_PROFILE"], [])).toEqual([]);
  });
  it("Story: uma mídia, só Facebook/Instagram", () => {
    expect(validateFormat("STORY", ["INSTAGRAM", "FACEBOOK_PAGE"], ["IMAGE"])).toEqual([]);
    expect(validateFormat("STORY", ["INSTAGRAM"], ["IMAGE", "IMAGE"]).length).toBe(1);
    expect(validateFormat("STORY", ["GOOGLE_BUSINESS_PROFILE"], ["IMAGE"])[0]?.message).toMatch(/não aceita Story/);
  });
  it("Story: vídeo acima de 60s é aceito (será cortado) até 10 partes", () => {
    expect(validateFormat("STORY", ["INSTAGRAM", "FACEBOOK_PAGE"], [{ kind: "VIDEO", durationSec: 105, bytes: 18e6 }])).toEqual([]);
    expect(validateFormat("STORY", ["INSTAGRAM"], [{ kind: "VIDEO", durationSec: 45 }])).toEqual([]);
    const tooLong = validateFormat("STORY", ["INSTAGRAM"], [{ kind: "VIDEO", durationSec: 700 }]);
    expect(tooLong[0]?.message).toMatch(/12 partes; o máximo é 10/);
  });
  it("planStorySegments: partes iguais de até 59s", () => {
    expect(planStorySegments(45)).toEqual([{ index: 0, startSec: 0, lengthSec: 45 }]);
    const two = planStorySegments(105);
    expect(two).toEqual([{ index: 0, startSec: 0, lengthSec: 52.5 }, { index: 1, startSec: 52.5, lengthSec: 52.5 }]);
    const three = planStorySegments(150);
    expect(three.length).toBe(3);
    expect(three.every((s) => s.lengthSec <= 59 && s.lengthSec >= 3)).toBe(true);
  });
  it("Story: vídeo acima de 100MB é rejeitado só no Instagram", () => {
    const issues = validateFormat("STORY", ["INSTAGRAM", "FACEBOOK_PAGE"], [{ kind: "VIDEO", durationSec: 30, bytes: 150 * 1024 * 1024 }]);
    expect(issues.map((i) => i.platform)).toEqual(["INSTAGRAM"]);
  });
  it("Reel: Facebook limita a 90s, Instagram a 15min", () => {
    expect(validateFormat("REEL", ["INSTAGRAM"], [{ kind: "VIDEO", durationSec: 120 }])).toEqual([]);
    expect(validateFormat("REEL", ["FACEBOOK_PAGE"], [{ kind: "VIDEO", durationSec: 120 }])[0]?.message).toMatch(/até 90s/);
  });
  it("Reel: exatamente um vídeo", () => {
    expect(validateFormat("REEL", ["INSTAGRAM"], ["VIDEO"])).toEqual([]);
    expect(validateFormat("REEL", ["INSTAGRAM"], ["IMAGE"])[0]?.message).toMatch(/um vídeo/);
  });
});

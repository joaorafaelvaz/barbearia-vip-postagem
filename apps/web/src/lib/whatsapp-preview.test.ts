import { describe, expect, it } from "vitest";
import { previewHtml } from "./whatsapp-preview";

describe("previewHtml", () => {
  it("escapa HTML e aplica negrito/itálico/quebra de linha", () => {
    expect(previewHtml("Olá *time* <b>x</b>\n_hoje_")).toBe("Olá <b>time</b> &lt;b&gt;x&lt;/b&gt;<br><i>hoje</i>");
  });
  it("não italiciza snake_case nem URLs com underscore", () => {
    expect(previewHtml("fechamento_de_caixa e https://x.y/a_b_c ok")).toBe("fechamento_de_caixa e https://x.y/a_b_c ok");
    expect(previewHtml("veja _isto_ e ab_cd_ef")).toBe("veja <i>isto</i> e ab_cd_ef");
    expect(previewHtml("_início_ e _fim_")).toBe("<i>início</i> e <i>fim</i>");
  });
});

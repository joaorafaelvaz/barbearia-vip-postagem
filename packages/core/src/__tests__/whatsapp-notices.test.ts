import { describe, expect, it } from "vitest";
import { canTransition, noticeJobId, normalizeUnitName, resolveNoticeTargets, sameRecurrence } from "../whatsapp-notices.js";

describe("sameRecurrence", () => {
  it("compara tipo, dias (ordenados) e dia, ignorando ordem de chaves e de dias (jsonb reordena)", () => {
    expect(sameRecurrence({ tipo: "semanal", dias: [4, 0] }, JSON.parse('{"dias":[0,4],"tipo":"semanal"}'))).toBe(true);
    expect(sameRecurrence({ tipo: "mensal", dia: "ultimo" }, { tipo: "mensal", dia: "ultimo" })).toBe(true);
    expect(sameRecurrence({ tipo: "mensal", dia: 31 }, { tipo: "mensal", dia: "ultimo" })).toBe(false);
    expect(sameRecurrence({ tipo: "diaria" }, { tipo: "nenhuma" })).toBe(false);
    expect(sameRecurrence({ tipo: "semanal", dias: [0] }, { tipo: "semanal", dias: [0, 1] })).toBe(false);
  });
});

describe("normalizeUnitName", () => {
  it("ignora acentos, caixa e espaços repetidos", () => {
    expect(normalizeUnitName("Florianópolis - SC 401")).toBe("florianopolis - sc 401");
    expect(normalizeUnitName("  São  José - Barreiros ")).toBe("sao jose - barreiros");
    expect(normalizeUnitName("CRICIÚMA - Michel")).toBe(normalizeUnitName("Criciúma - michel"));
  });
});

describe("resolveNoticeTargets", () => {
  const units = [
    { id: "u61", name: "SC 401", whatsappChatId: "a@g.us" },
    { id: "u20", name: "Itajaí", whatsappChatId: "b@g.us" },
    { id: "u99", name: "Sem grupo", whatsappChatId: null },
  ];
  it("unidades escolhidas + franqueadora, na ordem, sem duplicar", () => {
    expect(resolveNoticeTargets({ unidades: ["u61", "u20", "u61"], todas: false, franqueadora: true }, units, "f@g.us")).toEqual([
      { chatId: "a@g.us", name: "SC 401" },
      { chatId: "b@g.us", name: "Itajaí" },
      { chatId: "f@g.us", name: "Franqueadora" },
    ]);
  });
  it("todas ignora unidades sem chat e não repete um chat compartilhado", () => {
    const shared = [...units, { id: "u47", name: "Outra", whatsappChatId: "a@g.us" }];
    expect(resolveNoticeTargets({ unidades: [], todas: true, franqueadora: false }, shared, null)).toEqual([
      { chatId: "a@g.us", name: "SC 401" },
      { chatId: "b@g.us", name: "Itajaí" },
    ]);
  });
  it("franqueadora sem grupo cadastrado não entra", () => {
    expect(resolveNoticeTargets({ unidades: [], todas: false, franqueadora: true }, units, null)).toEqual([]);
  });
});

describe("noticeJobId / canTransition", () => {
  it("jobId determinístico por aviso, ocorrência e tentativa", () => {
    const occ = new Date("2026-10-25T18:00:00Z");
    expect(noticeJobId("n1", occ, 0)).toBe("whatsapp-notice-n1-1792951200000-0");
    expect(noticeJobId("n1", occ, 2)).not.toBe(noticeJobId("n1", occ, 0));
  });
  it("só as transições da lista branca", () => {
    expect(canTransition("ativo", "pausado")).toBe(true);
    expect(canTransition("pausado", "ativo")).toBe(true);
    expect(canTransition("pausado", "cancelado")).toBe(true);
    expect(canTransition("cancelado", "ativo")).toBe(false);
    expect(canTransition("enviando", "pausado")).toBe(false);
    expect(canTransition("concluido", "cancelado")).toBe(false);
  });
});

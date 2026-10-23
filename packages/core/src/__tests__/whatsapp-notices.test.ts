import { describe, expect, it } from "vitest";
import { localToUtc } from "../timezone.js";
import { canTransition, nextOccurrence, noticeJobId, normalizeUnitName, resolveNoticeTargets, sameRecurrence } from "../whatsapp-notices.js";

/** Horário de parede em São Paulo -> Date UTC (mesmo `dt()` dos testes do daily). */
const sp = (local: string) => localToUtc(local, "America/Sao_Paulo");

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

describe("nextOccurrence (portado de daily tests/test_agendamentos.py)", () => {
  it("única", () => {
    expect(nextOccurrence(null, sp("2026-10-25T15:00"), { tipo: "nenhuma" }, null)).toEqual(sp("2026-10-25T15:00"));
    expect(nextOccurrence(sp("2026-10-25T15:00"), sp("2026-10-25T15:00"), { tipo: "nenhuma" }, null)).toBeNull();
  });
  it("diária mantém horário", () => {
    expect(nextOccurrence(sp("2026-10-25T15:00"), sp("2026-10-25T15:00"), { tipo: "diaria" }, null)).toEqual(sp("2026-10-26T15:00"));
    expect(nextOccurrence(null, sp("2026-10-25T15:00"), { tipo: "diaria" }, null)).toEqual(sp("2026-10-25T15:00"));
  });
  it("semanal vários dias (0=segunda)", () => {
    const rec = { tipo: "semanal" as const, dias: [0, 4] }; // seg e sex
    expect(nextOccurrence(null, sp("2026-10-21T09:00"), rec, null)).toEqual(sp("2026-10-23T09:00")); // 21/10 é quarta -> sexta 23
    expect(nextOccurrence(sp("2026-10-23T09:00"), sp("2026-10-21T09:00"), rec, null)).toEqual(sp("2026-10-26T09:00")); // -> segunda 26
  });
  it("mensal dia 31 e 'ultimo'", () => {
    expect(nextOccurrence(sp("2026-10-31T08:00"), sp("2026-10-31T08:00"), { tipo: "mensal", dia: 31 }, null)).toEqual(sp("2026-11-30T08:00"));
    expect(nextOccurrence(null, sp("2026-02-10T08:00"), { tipo: "mensal", dia: "ultimo" }, null)).toEqual(sp("2026-02-28T08:00"));
  });
  it("fim encerra", () => {
    expect(nextOccurrence(sp("2026-10-25T15:00"), sp("2026-10-25T15:00"), { tipo: "diaria" }, sp("2026-10-25T23:59"))).toBeNull();
  });
  it("after anterior ao primeiro envio volta ao primeiro", () => {
    expect(nextOccurrence(sp("2026-10-01T10:00"), sp("2026-10-25T15:00"), { tipo: "diaria" }, null)).toEqual(sp("2026-10-25T15:00"));
  });
  it("diária com after no meio do dia, antes do horário, dispara no mesmo dia", () => {
    expect(nextOccurrence(sp("2026-10-26T09:00"), sp("2026-10-25T15:00"), { tipo: "diaria" }, null)).toEqual(sp("2026-10-26T15:00"));
  });
  it("diária no próprio dia do primeiro envio, antes do horário, dispara no primeiro", () => {
    expect(nextOccurrence(sp("2026-10-25T10:00"), sp("2026-10-25T15:00"), { tipo: "diaria" }, null)).toEqual(sp("2026-10-25T15:00"));
  });
  it("mensal dia 31 encadeia jan -> fev (28) -> mar (31) e cai em 29/02 em ano bissexto", () => {
    const rec = { tipo: "mensal" as const, dia: 31 };
    const first = sp("2026-01-31T08:00");
    const feb = nextOccurrence(first, first, rec, null);
    expect(feb).toEqual(sp("2026-02-28T08:00"));
    expect(nextOccurrence(feb, first, rec, null)).toEqual(sp("2026-03-31T08:00"));
    expect(nextOccurrence(sp("2028-01-31T08:00"), sp("2028-01-31T08:00"), rec, null)).toEqual(sp("2028-02-29T08:00"));
  });
  it("fim exatamente igual à candidata ainda devolve a candidata", () => {
    expect(nextOccurrence(sp("2026-10-25T15:00"), sp("2026-10-25T15:00"), { tipo: "diaria" }, sp("2026-10-26T15:00"))).toEqual(sp("2026-10-26T15:00"));
  });
  it("semanal [sexta] com after na própria sexta no mesmo horário vai para a sexta seguinte", () => {
    const rec = { tipo: "semanal" as const, dias: [4] };
    expect(nextOccurrence(sp("2026-10-23T09:00"), sp("2026-10-23T09:00"), rec, null)).toEqual(sp("2026-10-30T09:00")); // 23/10/2026 é sexta
  });
  it("mensal com dia inválido lança", () => {
    const first = sp("2026-10-25T08:00");
    for (const dia of [0, 32, -1, 1.5, Number.NaN]) {
      expect(() => nextOccurrence(null, first, { tipo: "mensal", dia }, null)).toThrow("dia do mês inválido");
    }
    expect(() => nextOccurrence(null, first, { tipo: "mensal", dia: "ultimo" }, null)).not.toThrow();
    expect(() => nextOccurrence(null, first, { tipo: "mensal", dia: 1 }, null)).not.toThrow();
  });
});

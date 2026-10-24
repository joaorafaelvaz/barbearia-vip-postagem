import { localToUtc } from "@fsp/core";
import { describe, expect, it } from "vitest";
import { assertResolvableTargets, changeNoticeState, createNotice, parseNoticeInput, planUpdate, updateNotice, CHAT_ID_RE } from "./whatsapp-notices";

const sp = (l: string) => localToUtc(l, "America/Sao_Paulo");
const now = sp("2026-10-23T10:00");
const base = { text: "Olá *time*", targets: { unidades: ["u1"], todas: false, franqueadora: false }, firstSendLocal: "2026-12-01T15:00", recurrence: { tipo: "nenhuma" as const } };

describe("parseNoticeInput", () => {
  it("aceita e converte horário de São Paulo para UTC", () => {
    const r = parseNoticeInput(base, now);
    expect(r.firstSendAt).toEqual(sp("2026-12-01T15:00"));
    expect(r.endAt).toBeNull();
  });
  it("endDate vira 23:59 de São Paulo", () => {
    expect(parseNoticeInput({ ...base, recurrence: { tipo: "diaria" }, endDate: "2026-12-10" }, now).endAt).toEqual(sp("2026-12-10T23:59"));
  });
  it("rejeita texto vazio, sem destino, passado, semanal sem dias, mensal inválido, fim antes do início", () => {
    expect(() => parseNoticeInput({ ...base, text: "  " }, now)).toThrow(/texto/i);
    expect(() => parseNoticeInput({ ...base, targets: { unidades: [], todas: false, franqueadora: false } }, now)).toThrow(/destino/i);
    expect(() => parseNoticeInput({ ...base, firstSendLocal: "2020-01-01T10:00" }, now)).toThrow(/futuro/i);
    expect(() => parseNoticeInput({ ...base, recurrence: { tipo: "semanal", dias: [] } }, now)).toThrow(/dia da semana/i);
    expect(() => parseNoticeInput({ ...base, recurrence: { tipo: "mensal", dia: 32 } }, now)).toThrow(/dia do mês/i);
    expect(() => parseNoticeInput({ ...base, recurrence: { tipo: "diaria" }, endDate: "2026-11-01" }, now)).toThrow(/data final/i);
  });
  it("semanal: dias deduplicados e em ordem numérica", () => {
    expect(parseNoticeInput({ ...base, recurrence: { tipo: "semanal", dias: [4, 0, 4] } }, now).recurrence).toEqual({ tipo: "semanal", dias: [0, 4] });
  });
  it("edição: primeiro envio no passado é aceito se não mudou", () => {
    const r = parseNoticeInput({ ...base, firstSendLocal: "2026-10-01T15:00", recurrence: { tipo: "diaria" } }, now, { previousFirstSendAt: sp("2026-10-01T15:00") });
    expect(r.firstSendAt).toEqual(sp("2026-10-01T15:00"));
  });
});

describe("planUpdate (regras de edição do daily)", () => {
  const current = { state: "pausado" as const, firstSendAt: sp("2026-10-01T15:00"), recurrence: { tipo: "diaria" as const }, nextRunAt: sp("2026-10-23T15:00") };
  it("preserva pausado e recalcula a partir de agora quando a regra mudou (semanal -> próximo dia válido)", () => {
    const p = planUpdate(current, { firstSendAt: sp("2026-10-01T15:00"), recurrence: { tipo: "semanal", dias: [0] }, endAt: null }, sp("2026-10-23T16:00"));
    expect(p).toEqual({ state: "pausado", nextRunAt: sp("2026-10-26T15:00") }); // 23/10 é sexta -> segunda 26
  });
  it("sem mudança de regra e ocorrência futura, recalcula a partir de agora", () => {
    const p = planUpdate({ ...current, nextRunAt: sp("2026-10-24T15:00") }, { firstSendAt: current.firstSendAt, recurrence: current.recurrence, endAt: null }, sp("2026-10-23T16:00"));
    expect(p).toEqual({ state: "pausado", nextRunAt: sp("2026-10-24T15:00") });
  });
  it("mantém a ocorrência vencida e não enviada quando a regra não mudou", () => {
    const stale = { ...current, state: "ativo" as const, nextRunAt: sp("2026-10-23T09:00") };
    expect(planUpdate(stale, { firstSendAt: stale.firstSendAt, recurrence: stale.recurrence, endAt: null }, now)).toEqual({ state: "ativo", nextRunAt: sp("2026-10-23T09:00") });
  });
  it("fim que exclui tudo conclui", () => {
    const p = planUpdate({ ...current, state: "ativo" }, { firstSendAt: current.firstSendAt, recurrence: { tipo: "nenhuma" }, endAt: sp("2026-10-02T00:00") }, now);
    expect(p).toEqual({ state: "concluido", nextRunAt: null });
  });
  it("recorrência vinda do jsonb (chaves/dias em outra ordem) conta como a mesma regra", () => {
    const stale = { ...current, state: "ativo" as const, recurrence: JSON.parse('{"dias":[4,0],"tipo":"semanal"}') as never, nextRunAt: sp("2026-10-23T09:00") };
    expect(planUpdate(stale, { firstSendAt: stale.firstSendAt, recurrence: { tipo: "semanal", dias: [0, 4] }, endAt: null }, now)).toEqual({ state: "ativo", nextRunAt: sp("2026-10-23T09:00") });
  });
  it("enviando -> 409; concluido/cancelado -> 404", () => {
    expect(() => planUpdate({ ...current, state: "enviando" }, { firstSendAt: current.firstSendAt, recurrence: current.recurrence, endAt: null }, now)).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => planUpdate({ ...current, state: "cancelado" }, { firstSendAt: current.firstSendAt, recurrence: current.recurrence, endAt: null }, now)).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe("assertResolvableTargets (como _parse_form do daily: >= 1 destino RESOLVIDO)", () => {
  const units = [{ id: "u1", name: "A", whatsappChatId: "a@g.us" }, { id: "u2", name: "B", whatsappChatId: null }];
  it("passa com unidade com grupo, com todas, ou com franqueadora cadastrada", () => {
    expect(() => assertResolvableTargets({ unidades: ["u1"], todas: false, franqueadora: false }, units, null)).not.toThrow();
    expect(() => assertResolvableTargets({ unidades: [], todas: true, franqueadora: false }, units, null)).not.toThrow();
    expect(() => assertResolvableTargets({ unidades: [], todas: false, franqueadora: true }, units, "f@g.us")).not.toThrow();
  });
  it("400 'Escolha ao menos um destino.' quando nada resolve: unidade sem grupo, franqueadora sem grupo, todas sem nenhuma unidade com grupo", () => {
    expect(() => assertResolvableTargets({ unidades: ["u2"], todas: false, franqueadora: false }, units, null)).toThrow("Escolha ao menos um destino.");
    expect(() => assertResolvableTargets({ unidades: [], todas: false, franqueadora: true }, units, null)).toThrow(/destino/i);
    expect(() => assertResolvableTargets({ unidades: [], todas: true, franqueadora: false }, [units[1]!], null)).toThrow(expect.objectContaining({ status: 400 }));
  });
});

describe("CHAT_ID_RE", () => {
  it("aceita grupo e número no formato WAHA", () => {
    expect(CHAT_ID_RE.test("120363424632069171@g.us")).toBe(true);
    expect(CHAT_ID_RE.test("554899161906-1529438950@g.us")).toBe(true);
    expect(CHAT_ID_RE.test("554899073477@c.us")).toBe(true);
    expect(CHAT_ID_RE.test("+55 48 9999-9999")).toBe(false);
  });
});

describe("datas impossíveis (passam no regex, mas 'rolam' para outro dia)", () => {
  it("31/02 no primeiro envio e 30/02 no fim -> 400", () => {
    expect(() => parseNoticeInput({ ...base, firstSendLocal: "2026-02-31T10:00" }, now)).toThrow(expect.objectContaining({ status: 400, message: "Data/hora inválida." }));
    expect(() => parseNoticeInput({ ...base, recurrence: { tipo: "diaria" }, endDate: "2027-02-30" }, now)).toThrow(/inválida/);
    expect(parseNoticeInput({ ...base, recurrence: { tipo: "diaria" }, endDate: "2028-02-29" }, now).endAt).toEqual(sp("2028-02-29T23:59"));
  });
});

/** Prisma falso mínimo para os fluxos de criar/editar/estado (sem banco). */
function fakePrisma(notice: Record<string, unknown> | null) {
  const calls: Array<{ op: string; args: unknown }> = [];
  const prisma = {
    unit: {
      async count() { return 1; },
      async findMany() { return [{ id: "u1", name: "A", whatsappChatId: "a@g.us" }]; },
    },
    organization: { async findUniqueOrThrow() { return { whatsappChatId: null }; } },
    whatsappNotice: {
      async findFirst() { return notice; },
      async create(args: unknown) { calls.push({ op: "create", args }); return { id: "n1", state: "ativo", nextRunAt: sp("2026-12-01T15:00") }; },
      async updateMany(args: unknown) { calls.push({ op: "updateMany", args }); return { count: 1 }; },
      async findUniqueOrThrow() { return { ...notice, id: "n1", state: "ativo", nextRunAt: sp("2026-12-01T15:00") }; },
    },
  };
  return { prisma: prisma as never, calls };
}
const brokenQueue = { async add() { throw new Error("ECONNREFUSED redis"); }, async getJob() { throw new Error("ECONNREFUSED redis"); } };
const activeNotice = { id: "n1", organizationId: "o1", state: "ativo", firstSendAt: sp("2026-12-01T15:00"), recurrence: { tipo: "nenhuma" }, nextRunAt: sp("2026-12-01T15:00"), consecutiveFailures: 0 };

describe("fila indisponível depois da escrita no banco não vira 500 (a reconciliação recupera)", () => {
  it("createNotice devolve o aviso e loga 'notice queue failed'", async () => {
    const { prisma } = fakePrisma(null);
    const logs: string[] = [];
    const notice = await createNotice({ prisma, queue: brokenQueue, log: (m) => { logs.push(m); } }, "o1", "me", base);
    expect(notice.id).toBe("n1");
    expect(logs).toEqual(["notice queue failed"]);
  });
  it("updateNotice e changeNoticeState também; o UPDATE filtra por organizationId", async () => {
    const { prisma, calls } = fakePrisma(activeNotice);
    const logs: string[] = [];
    await updateNotice({ prisma, queue: brokenQueue, log: (m) => { logs.push(m); } }, "o1", "n1", base);
    await changeNoticeState({ prisma, queue: brokenQueue, log: (m) => { logs.push(m); } }, "o1", "n1", "pausado");
    expect(logs).toEqual(["notice queue failed", "notice queue failed", "notice queue failed"]); // dequeue + enqueue na edição, dequeue ao pausar
    for (const c of calls.filter((c) => c.op === "updateMany")) expect((c.args as { where: { organizationId?: string } }).where.organizationId).toBe("o1");
  });
});

describe("fila pendurada (Redis fora: o add não rejeita, fica esperando)", () => {
  it("createNotice devolve em até queueTimeoutMs e loga 'notice queue timeout'", async () => {
    const { prisma } = fakePrisma(null);
    const logs: string[] = [];
    const hanging = { add: () => new Promise<never>(() => {}), async getJob() { return undefined; } };
    const started = Date.now();
    const notice = await createNotice({ prisma, queue: hanging, log: (m) => { logs.push(m); }, queueTimeoutMs: 30 }, "o1", "me", base);
    expect(notice.id).toBe("n1");
    expect(logs).toEqual(["notice queue timeout"]);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("updateNotice checa o estado antes de validar a entrada", () => {
  it("cancelado com dados inválidos -> 404 (não 400)", async () => {
    const { prisma } = fakePrisma({ ...activeNotice, state: "cancelado" });
    await expect(updateNotice({ prisma, queue: brokenQueue }, "o1", "n1", { ...base, text: "" })).rejects.toMatchObject({ status: 404 });
  });
  it("enviando -> 409 antes de validar", async () => {
    const { prisma } = fakePrisma({ ...activeNotice, state: "enviando" });
    await expect(updateNotice({ prisma, queue: brokenQueue }, "o1", "n1", { nonsense: true })).rejects.toMatchObject({ status: 409 });
  });
});

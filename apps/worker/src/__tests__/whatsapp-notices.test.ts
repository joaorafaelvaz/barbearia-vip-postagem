import { localToUtc, type DeliveryStatus } from "@fsp/core";
import type { PublishQueueLike } from "@fsp/queue";
import { describe, expect, it } from "vitest";
import { processNotice, reconcileNotices, type NoticeDeps, type NoticeRecord, type NoticeRepository } from "../whatsapp-notices.js";

const sp = (l: string) => localToUtc(l, "America/Sao_Paulo");
const T0 = sp("2026-10-25T15:00");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

function fakeQueue() {
  const jobs = new Map<string, { data: unknown; delay: number }>();
  const queue: PublishQueueLike = {
    async add(_n, data, opts) { const id = String(opts?.jobId); if (!jobs.has(id)) jobs.set(id, { data, delay: Number(opts?.delay ?? 0) }); return {}; },
    async getJob(id) { return jobs.has(id) ? { async remove() { jobs.delete(id); }, async getState() { return "delayed"; } } : undefined; },
  };
  return { queue, jobs };
}

interface Row { status: DeliveryStatus; chatId: string; name: string; error?: string | undefined }

/** Repositório em memória com um único aviso. */
function fakeRepo(over: Partial<NoticeRecord> = {}, chats: Record<string, string | null> = { u61: "a@g.us", u63: "b@g.us" }) {
  const notice: NoticeRecord = {
    id: "n1", organizationId: "o1", text: "oi", targets: { unidades: ["u61", "u63"], todas: false, franqueadora: false },
    firstSendAt: T0, recurrence: { tipo: "diaria" }, endAt: null, nextRunAt: T0, state: "ativo", consecutiveFailures: 0, sendingStartedAt: null, ...over,
  };
  const rows = new Map<string, Row>(); // key = occurrence|chatId
  let clock = () => new Date(); // relógio do "banco" (sendingStartedAt/updatedAt); setClock() congela
  let updatedAt = new Date(0);
  const repo: NoticeRepository = {
    async loadNotice(id) { return id === notice.id ? { ...notice } : null; },
    async claim(id, occ) {
      if (id !== notice.id || notice.state !== "ativo" || notice.nextRunAt?.getTime() !== occ.getTime()) return false;
      notice.state = "enviando"; notice.sendingStartedAt = clock(); updatedAt = clock(); return true;
    },
    async listUnitChats() { return Object.entries(chats).map(([id, chat]) => ({ id, name: id, whatsappChatId: chat })); },
    async franchisorChatId() { return "f@g.us"; },
    async sentChatIds(_id, occ) { return new Set([...rows.entries()].filter(([k, r]) => k.startsWith(occ.toISOString()) && r.status === "enviado").map(([, r]) => r.chatId)); },
    async recordDelivery(d) { rows.set(`${d.occurrenceAt.toISOString()}|${d.chatId}`, { status: d.status, chatId: d.chatId, name: d.targetName, error: d.error }); },
    async finishCycle(id, patch) {
      if (id !== notice.id || notice.state !== "enviando") return false;
      Object.assign(notice, patch, { sendingStartedAt: null }); updatedAt = clock(); return true;
    },
    async touchSending(id) { if (id === notice.id && notice.state === "enviando") notice.sendingStartedAt = clock(); },
    async listStaleSending(before) { return notice.state === "enviando" && (notice.sendingStartedAt === null || notice.sendingStartedAt.getTime() < before.getTime()) ? [{ id: notice.id }] : []; },
    async releaseStale(id) { if (id === notice.id && notice.state === "enviando") { notice.state = "ativo"; notice.sendingStartedAt = null; } },
    async listActive(updatedBefore) { return notice.state === "ativo" && notice.nextRunAt && updatedAt.getTime() < updatedBefore.getTime() ? [{ id: notice.id, nextRunAt: notice.nextRunAt, consecutiveFailures: notice.consecutiveFailures }] : []; },
  };
  return { repo, notice, rows: () => [...rows.values()], setClock: (d: Date) => { clock = () => d; } };
}

type Deps = NoticeDeps & { sent: string[]; sleeps: number[] };
function deps(repo: NoticeRepository, queue: PublishQueueLike, send: (chat: string) => boolean, now: Date): Deps {
  const sent: string[] = [];
  const sleeps: number[] = [];
  return { repo, queue, sender: { async sendText(chat) { sent.push(chat); return send(chat); } }, now: () => now, sleep: async (ms) => { sleeps.push(ms); }, sent, sleeps };
}

describe("processNotice", () => {
  it("envia o vencido, grava enviado por destino, avança e enfileira a próxima ocorrência", async () => {
    const { repo, notice, rows } = fakeRepo();
    const { queue, jobs } = fakeQueue();
    const d = deps(repo, queue, () => true, min(1));
    const out = await processNotice(d, { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(out).toEqual({ outcome: "sent", sent: 2, failed: 0 });
    expect(d.sent).toEqual(["a@g.us", "b@g.us"]);
    expect(notice.state).toBe("ativo");
    expect(notice.nextRunAt).toEqual(sp("2026-10-26T15:00"));
    expect(rows().map((r) => r.status)).toEqual(["enviado", "enviado"]);
    expect([...jobs.keys()]).toEqual([`whatsapp-notice-n1-${sp("2026-10-26T15:00").getTime()}-0`]);
  });

  it("atraso maior que 2h marca perdido sem enviar e conclui o único", async () => {
    const { repo, notice, rows } = fakeRepo({ recurrence: { tipo: "nenhuma" } });
    const d = deps(repo, fakeQueue().queue, () => true, new Date(T0.getTime() + 3 * 3_600_000));
    const out = await processNotice(d, { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(out.outcome).toBe("missed");
    expect(d.sent).toEqual([]);
    expect(notice.state).toBe("concluido");
    expect(rows().every((r) => r.status === "perdido")).toBe(true);
  });

  it("sucesso parcial conta como ciclo ok", async () => {
    const { repo, notice, rows } = fakeRepo({ recurrence: { tipo: "nenhuma" } });
    const d = deps(repo, fakeQueue().queue, (c) => c === "a@g.us", min(1));
    await processNotice(d, { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(notice.state).toBe("concluido");
    expect(notice.consecutiveFailures).toBe(0);
    expect(rows().map((r) => r.status).sort()).toEqual(["enviado", "falhou"]);
  });

  it("três falhas pausam sem avançar, com retentativas de id 1 e 2 e linha de sistema", async () => {
    const { repo, notice, rows } = fakeRepo({ targets: { unidades: ["u61"], todas: false, franqueadora: false } });
    const { queue, jobs } = fakeQueue();
    for (let i = 0; i < 3; i++) {
      const out = await processNotice(deps(repo, queue, () => false, min(1 + i)), { noticeId: "n1", occurrenceAt: T0.toISOString() });
      expect(out.outcome).toBe(i < 2 ? "retry" : "paused");
    }
    expect(notice.state).toBe("pausado");
    expect(notice.consecutiveFailures).toBe(3);
    expect(notice.nextRunAt).toEqual(T0);
    expect([...jobs.keys()]).toEqual([`whatsapp-notice-n1-${T0.getTime()}-1`, `whatsapp-notice-n1-${T0.getTime()}-2`]);
    expect(jobs.get(`whatsapp-notice-n1-${T0.getTime()}-1`)?.delay).toBe(60_000);
    const sys = rows().find((r) => r.chatId === "-");
    expect(sys).toMatchObject({ name: "sistema", status: "pausado", error: "pausado automaticamente apos 3 falhas consecutivas" });
  });

  it("retentativa não reenvia a quem já recebeu (exceção no meio do ciclo)", async () => {
    const { repo, notice } = fakeRepo({ recurrence: { tipo: "nenhuma" } });
    const { queue } = fakeQueue();
    const d1 = deps(repo, queue, (c) => { if (c === "b@g.us") throw new Error("queda"); return true; }, min(1));
    expect((await processNotice(d1, { noticeId: "n1", occurrenceAt: T0.toISOString() })).outcome).toBe("retry");
    expect(notice.state).toBe("ativo");
    expect(notice.consecutiveFailures).toBe(1);
    const d2 = deps(repo, queue, () => true, min(2));
    await processNotice(d2, { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(d2.sent).toEqual(["b@g.us"]);
    expect(notice.state).toBe("concluido");
  });

  it("reserva falha (pausado/editado/ocorrência antiga) -> skipped, nada enviado", async () => {
    const { repo } = fakeRepo({ state: "pausado" });
    const d = deps(repo, fakeQueue().queue, () => true, min(1));
    expect(await processNotice(d, { noticeId: "n1", occurrenceAt: T0.toISOString() })).toEqual({ outcome: "skipped", reason: "não reservado" });
    expect(d.sent).toEqual([]);
  });

  it("sem destinos válidos pausa já com motivo", async () => {
    const { repo, notice, rows } = fakeRepo({}, { u61: null, u63: null });
    const out = await processNotice(deps(repo, fakeQueue().queue, () => true, min(1)), { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(out.outcome).toBe("paused");
    expect(notice.state).toBe("pausado");
    expect(rows()[0]).toMatchObject({ chatId: "-", status: "pausado", error: "sem destinos válidos" });
  });

  it("franqueadora entra como destino", async () => {
    const { repo } = fakeRepo({ targets: { unidades: [], todas: false, franqueadora: true }, recurrence: { tipo: "nenhuma" } });
    const d = deps(repo, fakeQueue().queue, () => true, min(1));
    await processNotice(d, { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(d.sent).toEqual(["f@g.us"]);
  });

  it("pausa de 1,5 s só ENTRE envios (2 destinos -> 1 sleep)", async () => {
    const { repo } = fakeRepo();
    const d = deps(repo, fakeQueue().queue, () => true, min(1));
    await processNotice(d, { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(d.sleeps).toEqual([1500]);
    const one = fakeRepo({ targets: { unidades: ["u61"], todas: false, franqueadora: false } });
    const d1 = deps(one.repo, fakeQueue().queue, () => true, min(1));
    await processNotice(d1, { noticeId: "n1", occurrenceAt: T0.toISOString() });
    expect(d1.sleeps).toEqual([]);
  });

  it("heartbeat: um ciclo ainda enviando não é solto pela reconciliação", async () => {
    const { repo, notice, setClock } = fakeRepo({ state: "enviando", sendingStartedAt: min(-15) }); // reservado há 15 min (preso?)
    setClock(min(0));
    await repo.touchSending("n1"); // ...mas acabou de gravar um envio: heartbeat renova a reserva
    const out = await reconcileNotices({ repo, queue: fakeQueue().queue, now: () => min(0) });
    expect(out.staleReleased).toBe(0);
    expect(notice.state).toBe("enviando");
    const stuck = fakeRepo({ state: "enviando", sendingStartedAt: min(-15) }); // sem heartbeat: solto
    expect((await reconcileNotices({ repo: stuck.repo, queue: fakeQueue().queue, now: () => min(0) })).staleReleased).toBe(1);
    expect(stuck.notice.state).toBe("ativo");
  });

  it("carência: a reconciliação não atropela uma retentativa recém-enfileirada", async () => {
    const { repo, setClock } = fakeRepo({ targets: { unidades: ["u61"], todas: false, franqueadora: false } });
    setClock(min(1));
    const { queue, jobs } = fakeQueue();
    await processNotice(deps(repo, queue, () => false, min(1)), { noticeId: "n1", occurrenceAt: T0.toISOString() }); // falha -> retentativa id 1 (+60 s)
    expect([...jobs.keys()]).toEqual([`whatsapp-notice-n1-${T0.getTime()}-1`]);
    jobs.clear(); // simula Redis sem o job (pior caso)
    expect((await reconcileNotices({ repo, queue, now: () => min(2) })).requeued).toBe(0); // updatedAt há 1 min < OVERDUE_GRACE_MS (2 min)
    expect((await reconcileNotices({ repo, queue, now: () => min(4) })).requeued).toBe(1); // passou a carência: reenfileira com a tentativa atual
    expect([...jobs.keys()]).toEqual([`whatsapp-notice-n1-${T0.getTime()}-1`]);
  });
});

describe("reconcileNotices", () => {
  it("solta presos em enviando e reenfileira ativos sem job (vencido para já, futuro para o horário)", async () => {
    const released: string[] = [];
    const repo: NoticeRepository = {
      ...fakeRepo().repo,
      async listStaleSending() { return [{ id: "stuck" }]; },
      async releaseStale(id) { released.push(id); },
      async listActive(updatedBefore) {
        expect(updatedBefore).toEqual(min(3)); // agora (min 5) - OVERDUE_GRACE_MS (2 min)
        return [{ id: "stuck", nextRunAt: T0, consecutiveFailures: 0 }, { id: "lost", nextRunAt: min(-30), consecutiveFailures: 1 }, { id: "has", nextRunAt: min(60), consecutiveFailures: 0 }, { id: "future", nextRunAt: min(120), consecutiveFailures: 0 }];
      },
    };
    const { queue, jobs } = fakeQueue();
    jobs.set(`whatsapp-notice-has-${min(60).getTime()}-0`, { data: {}, delay: 0 });
    const out = await reconcileNotices({ repo, queue, now: () => min(5) });
    expect(out).toEqual({ staleReleased: 1, requeued: 3 });
    expect(released).toEqual(["stuck"]);
    expect(jobs.get(`whatsapp-notice-lost-${min(-30).getTime()}-1`)?.delay).toBe(0);
    expect(jobs.get(`whatsapp-notice-future-${min(120).getTime()}-0`)?.delay).toBe(115 * 60_000);
    expect(jobs.size).toBe(4);
  });
});

import { describe, expect, it } from "vitest";
import { dequeueNotice, dequeuePublish, enqueueNotice, enqueuePublish, hasNoticeJob, requeuePublish, type PublishQueueLike } from "../index.js";

function fakeQueue(initialState = "delayed") {
  const jobs = new Map<string, { data: unknown; opts: Record<string, unknown>; state: string }>();
  const queue: PublishQueueLike = {
    async add(_name, data, opts) {
      const id = String(opts?.jobId);
      if (jobs.has(id)) return jobs.get(id); // BullMQ ignora add com jobId repetido
      jobs.set(id, { data, opts: (opts ?? {}) as Record<string, unknown>, state: initialState });
      return { id };
    },
    async getJob(jobId) {
      const j = jobs.get(jobId);
      if (!j) return undefined;
      return {
        async remove() {
          jobs.delete(jobId);
        },
        async getState() {
          return j.state;
        },
      };
    },
  };
  return { queue, jobs };
}

describe("enqueuePublish", () => {
  it("usa jobId determinístico e delay até o horário", async () => {
    const { queue, jobs } = fakeQueue();
    const now = new Date("2026-10-03T12:00:00Z");
    await enqueuePublish(queue, "t1", new Date("2026-10-03T12:10:00Z"), now);
    const job = jobs.get("post-target-t1");
    expect(job?.opts.delay).toBe(600_000);
    expect(job?.data).toEqual({ postTargetId: "t1" });
  });

  it("enfileirar o mesmo target duas vezes não duplica", async () => {
    const { queue, jobs } = fakeQueue();
    const when = new Date(Date.now() + 60_000);
    await enqueuePublish(queue, "t1", when);
    await enqueuePublish(queue, "t1", when);
    expect(jobs.size).toBe(1);
  });
});

describe("dequeue/requeue", () => {
  it("cancela job pendente", async () => {
    const { queue, jobs } = fakeQueue();
    await enqueuePublish(queue, "t1", new Date(Date.now() + 60_000));
    expect(await dequeuePublish(queue, "t1")).toBe(true);
    expect(jobs.size).toBe(0);
    expect(await dequeuePublish(queue, "t1")).toBe(false);
  });

  it("não remove job ativo", async () => {
    const { queue, jobs } = fakeQueue("active");
    await enqueuePublish(queue, "t1", new Date());
    expect(await dequeuePublish(queue, "t1")).toBe(false);
    expect(jobs.size).toBe(1);
  });

  it("requeue substitui o job com novo horário", async () => {
    const { queue, jobs } = fakeQueue();
    const now = new Date("2026-10-03T12:00:00Z");
    await enqueuePublish(queue, "t1", new Date("2026-10-03T12:10:00Z"), now);
    await requeuePublish(queue, "t1", new Date("2026-10-03T12:00:30Z"), now);
    expect(jobs.size).toBe(1);
    expect(jobs.get("post-target-t1")?.opts.delay).toBe(30_000);
  });
});

describe("enqueueNotice", () => {
  const now = new Date("2026-10-25T17:00:00Z");
  const occ = new Date("2026-10-25T18:00:00Z");
  it("jobId por aviso/ocorrência/tentativa, delay até a ocorrência, payload com ISO", async () => {
    const { queue, jobs } = fakeQueue();
    await enqueueNotice(queue, "n1", occ, 0, now);
    const job = jobs.get("whatsapp-notice-n1-1792951200000-0");
    expect(job?.opts.delay).toBe(3_600_000);
    expect(job?.data).toEqual({ noticeId: "n1", occurrenceAt: "2026-10-25T18:00:00.000Z" });
    expect(await hasNoticeJob(queue, "n1", occ, 0)).toBe(true);
    expect(await hasNoticeJob(queue, "n1", occ, 1)).toBe(false);
  });
  it("runAt explícito (retentativa) e remoção", async () => {
    const { queue, jobs } = fakeQueue();
    await enqueueNotice(queue, "n1", occ, 1, now, new Date("2026-10-25T18:03:00Z"));
    expect(jobs.get("whatsapp-notice-n1-1792951200000-1")?.opts.delay).toBe(3_780_000);
    expect(await dequeueNotice(queue, "n1", occ, 1)).toBe(true);
    expect(jobs.size).toBe(0);
  });
});

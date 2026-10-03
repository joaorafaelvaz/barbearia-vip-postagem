import { describe, expect, it } from "vitest";
import { dequeuePublish, enqueuePublish, requeuePublish, type PublishQueueLike } from "../index.js";

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

import { describe, expect, it } from "vitest";
import type { PublishQueueLike } from "@fsp/queue";
import { reconcileTargets, type ReconcileRepository } from "../reconcile.js";

function fakeQueue(existing: string[] = []) {
  const jobs = new Map<string, unknown>(existing.map((id) => [`post-target-${id}`, {}]));
  const added: string[] = [];
  const delays = new Map<string, number>();
  const queue: PublishQueueLike = {
    async add(_n, data, opts) { jobs.set(String(opts?.jobId), data); added.push(data.postTargetId); delays.set(data.postTargetId, Number(opts?.delay ?? 0)); return {}; },
    async getJob(id) { return jobs.has(id) ? { async remove() { jobs.delete(id); }, async getState() { return "delayed"; } } : undefined; },
  };
  return { queue, added, delays };
}

describe("reconcileTargets", () => {
  const now = () => new Date("2026-10-05T12:00:00Z");

  it("devolve PUBLISHING presos à fila e reenfileira agendados sem job (vencidos para já, futuros para o horário)", async () => {
    const reset: string[] = [];
    const repo: ReconcileRepository = {
      async listStalePublishing() { return [{ id: "stuck" }]; },
      async listScheduled() { return [{ id: "lost", scheduledAt: new Date("2026-10-05T11:00:00Z") }, { id: "has-job", scheduledAt: new Date("2026-10-05T11:30:00Z") }, { id: "future", scheduledAt: new Date("2026-10-06T09:00:00Z") }]; },
      async resetToScheduled(id) { reset.push(id); },
    };
    const { queue, added, delays } = fakeQueue(["has-job"]);
    const out = await reconcileTargets({ repo, queue, now });
    expect(out).toEqual({ stalledReset: 1, requeued: 2 });
    expect(reset).toEqual(["stuck"]);
    expect(added.sort()).toEqual(["future", "lost", "stuck"]);
    expect(delays.get("future")).toBe(new Date("2026-10-06T09:00:00Z").getTime() - now().getTime());
    expect(delays.get("lost")).toBe(0);
  });

  it("nada a fazer quando tudo está em dia", async () => {
    const repo: ReconcileRepository = {
      async listStalePublishing() { return []; },
      async listScheduled() { return []; },
      async resetToScheduled() {},
    };
    const { queue, added } = fakeQueue();
    expect(await reconcileTargets({ repo, queue, now })).toEqual({ stalledReset: 0, requeued: 0 });
    expect(added).toEqual([]);
  });
});

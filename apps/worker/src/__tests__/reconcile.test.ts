import { describe, expect, it } from "vitest";
import type { PublishQueueLike } from "@fsp/queue";
import { reconcileTargets, type ReconcileRepository } from "../reconcile.js";

function fakeQueue(existing: string[] = []) {
  const jobs = new Map<string, unknown>(existing.map((id) => [`post-target-${id}`, {}]));
  const added: string[] = [];
  const queue: PublishQueueLike = {
    async add(_n, data, opts) { jobs.set(String(opts?.jobId), data); added.push(data.postTargetId); return {}; },
    async getJob(id) { return jobs.has(id) ? { async remove() { jobs.delete(id); }, async getState() { return "delayed"; } } : undefined; },
  };
  return { queue, added };
}

describe("reconcileTargets", () => {
  const now = () => new Date("2026-10-05T12:00:00Z");

  it("devolve PUBLISHING presos à fila e reenfileira vencidos sem job", async () => {
    const reset: string[] = [];
    const repo: ReconcileRepository = {
      async listStalePublishing() { return [{ id: "stuck" }]; },
      async listOverdueScheduled() { return [{ id: "lost", scheduledAt: new Date("2026-10-05T11:00:00Z") }, { id: "has-job", scheduledAt: new Date("2026-10-05T11:30:00Z") }]; },
      async resetToScheduled(id) { reset.push(id); },
    };
    const { queue, added } = fakeQueue(["has-job"]);
    const out = await reconcileTargets({ repo, queue, now });
    expect(out).toEqual({ stalledReset: 1, overdueRequeued: 1 });
    expect(reset).toEqual(["stuck"]);
    expect(added.sort()).toEqual(["lost", "stuck"]);
  });

  it("nada a fazer quando tudo está em dia", async () => {
    const repo: ReconcileRepository = {
      async listStalePublishing() { return []; },
      async listOverdueScheduled() { return []; },
      async resetToScheduled() {},
    };
    const { queue, added } = fakeQueue();
    expect(await reconcileTargets({ repo, queue, now })).toEqual({ stalledReset: 0, overdueRequeued: 0 });
    expect(added).toEqual([]);
  });
});

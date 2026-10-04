import { enqueueMetricsNow } from "@fsp/queue";
import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { getQueue } from "@/lib/queue";
import { requireSession } from "@/lib/session";

/** Dispara a coleta de métricas da organização (no máximo uma por minuto). */
export const POST = route(async () => {
  const s = await requireSession();
  await enqueueMetricsNow(getQueue(), s.organizationId);
  return NextResponse.json({ ok: true });
});

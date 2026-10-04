import { enqueueImportNow } from "@fsp/queue";
import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { getQueue } from "@/lib/queue";
import { requireSession } from "@/lib/session";

/** Importa as publicações existentes (últimos 90 dias) de todas as contas da organização. */
export const POST = route(async () => {
  const s = await requireSession();
  await enqueueImportNow(getQueue(), { organizationId: s.organizationId });
  return NextResponse.json({ ok: true });
});

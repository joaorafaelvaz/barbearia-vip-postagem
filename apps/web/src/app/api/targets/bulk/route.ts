import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/api";
import { allowedUnitIds } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getQueue } from "@/lib/queue";
import { cancelAllTargets, retryAllTargets } from "@/lib/services/posts";
import { requireSession } from "@/lib/session";

const schema = z.object({
  action: z.enum(["retry", "cancel"]),
  postId: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/** Ações em lote: re-tentar (falhas e canceladas) ou cancelar (pendentes), por postagem ou por período. */
export const POST = route(async (req: Request) => {
  const s = await requireSession();
  const input = schema.parse(await req.json());
  const scope = { ...(input.postId ? { postId: input.postId } : {}), ...(input.from ? { from: new Date(input.from) } : {}), ...(input.to ? { to: new Date(input.to) } : {}) };
  const deps = { prisma, queue: getQueue() };
  const allowed = await allowedUnitIds(prisma, s);
  const count = input.action === "retry" ? await retryAllTargets(deps, s.organizationId, allowed, scope) : await cancelAllTargets(deps, s.organizationId, allowed, scope);
  return NextResponse.json({ ok: true, count });
});

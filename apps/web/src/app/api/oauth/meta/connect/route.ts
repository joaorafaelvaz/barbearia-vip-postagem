import { listMetaPages } from "@fsp/connectors";
import { enqueueImportNow } from "@fsp/queue";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, route } from "@/lib/api";
import { assertUnitAllowed } from "@/lib/authz";
import { getCipher } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { getQueue } from "@/lib/queue";
import { META_PENDING_COOKIE } from "@/lib/oauth-meta";
import { connectMetaPages } from "@/lib/services/accounts";
import { requireSession } from "@/lib/session";

const schema = z.object({ unitId: z.string().min(1), pageIds: z.array(z.string().min(1)).min(1) });

/** Recebe as Pages escolhidas na tela de seleção e vincula à unidade. */
export const POST = route(async (req: Request) => {
  const s = await requireSession();
  const input = schema.parse(await req.json());
  await assertUnitAllowed(prisma, s, input.unitId);
  const pending = (await cookies()).get(META_PENDING_COOKIE)?.value;
  if (!pending) throw new HttpError(400, "Sessão de conexão expirada. Conecte novamente.");
  const userToken = getCipher().decrypt(pending);
  const pages = (await listMetaPages(userToken)).filter((p) => input.pageIds.includes(p.id));
  if (pages.length === 0) throw new HttpError(400, "Nenhuma Page válida selecionada.");
  await connectMetaPages({ prisma, cipher: getCipher() }, s.organizationId, input.unitId, pages);
  await enqueueImportNow(getQueue(), { organizationId: s.organizationId }).catch(() => undefined); // importa o histórico das contas novas
  const res = NextResponse.json({ connected: pages.length });
  res.cookies.set(META_PENDING_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});

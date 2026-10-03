import { listGoogleLocations } from "@fsp/connectors";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, route } from "@/lib/api";
import { getCipher } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { GOOGLE_PENDING_COOKIE, type GooglePending } from "@/lib/oauth-google";
import { connectGoogleLocations } from "@/lib/services/accounts";
import { requireSession } from "@/lib/session";

const schema = z.object({ unitId: z.string().min(1), locationNames: z.array(z.string().min(1)).min(1) });

export const POST = route(async (req: Request) => {
  const s = await requireSession();
  const input = schema.parse(await req.json());
  const raw = (await cookies()).get(GOOGLE_PENDING_COOKIE)?.value;
  if (!raw) throw new HttpError(400, "Sessão de conexão expirada. Conecte novamente.");
  const pending = JSON.parse(getCipher().decrypt(raw)) as GooglePending;
  const locations = (await listGoogleLocations(pending.accessToken)).filter((l) => input.locationNames.includes(l.name));
  if (locations.length === 0) throw new HttpError(400, "Nenhuma location válida selecionada.");
  await connectGoogleLocations({ prisma, cipher: getCipher() }, s.organizationId, input.unitId, locations, {
    accessToken: pending.accessToken,
    refreshToken: pending.refreshToken,
    expiresAt: new Date(pending.expiresAt),
  });
  const res = NextResponse.json({ connected: locations.length });
  res.cookies.set(GOOGLE_PENDING_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
});

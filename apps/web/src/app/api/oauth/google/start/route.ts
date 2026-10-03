import { buildGoogleAuthorizeUrl } from "@fsp/connectors";
import { NextResponse } from "next/server";
import { HttpError, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { googleConfig } from "@/lib/oauth-google";
import { signOAuthState } from "@/lib/oauth-state";
import { requireSession } from "@/lib/session";

export const GET = route(async (req: Request) => {
  const s = await requireSession();
  const unitId = new URL(req.url).searchParams.get("unitId");
  if (!unitId) throw new HttpError(400, "unitId obrigatório");
  const unit = await prisma.unit.findFirst({ where: { id: unitId, organizationId: s.organizationId } });
  if (!unit) throw new HttpError(404, "Unidade não encontrada");
  const state = await signOAuthState({ organizationId: s.organizationId, userId: s.userId, unitId, provider: "google" });
  return NextResponse.redirect(buildGoogleAuthorizeUrl(googleConfig(), state));
});

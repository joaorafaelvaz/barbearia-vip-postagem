import { buildYouTubeAuthorizeUrl } from "@fsp/connectors";
import { NextResponse } from "next/server";
import { HttpError, route } from "@/lib/api";
import { assertUnitAllowed } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { signOAuthState } from "@/lib/oauth-state";
import { youtubeConfig } from "@/lib/oauth-youtube";
import { requireSession } from "@/lib/session";

export const GET = route(async (req: Request) => {
  const s = await requireSession();
  const unitId = new URL(req.url).searchParams.get("unitId");
  if (!unitId) throw new HttpError(400, "unitId obrigatório");
  await assertUnitAllowed(prisma, s, unitId);
  const state = await signOAuthState({ organizationId: s.organizationId, userId: s.userId, unitId, provider: "youtube" });
  return NextResponse.redirect(buildYouTubeAuthorizeUrl(youtubeConfig(), state));
});

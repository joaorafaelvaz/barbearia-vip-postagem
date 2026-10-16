import { exchangeGoogleCode, listYouTubeChannels } from "@fsp/connectors";
import { enqueueImportNow } from "@fsp/queue";
import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { getCipher } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { verifyOAuthState } from "@/lib/oauth-state";
import { youtubeConfig } from "@/lib/oauth-youtube";
import { getQueue } from "@/lib/queue";
import { connectYouTubeChannels } from "@/lib/services/accounts";
import { requireSession } from "@/lib/session";

/** Vincula todos os canais do usuário autenticado (normalmente um) à unidade do state. */
export const GET = route(async (req: Request) => {
  const s = await requireSession();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  const state = stateToken ? await verifyOAuthState(stateToken, "youtube") : null;
  if (!code || !state || state.organizationId !== s.organizationId) {
    return NextResponse.redirect(`${appUrl()}/unidades?erro=youtube_state`);
  }
  const tokens = await exchangeGoogleCode(youtubeConfig(), code);
  if (!tokens.refreshToken) return NextResponse.redirect(`${appUrl()}/unidades?erro=youtube_refresh`);
  const channels = await listYouTubeChannels(tokens.accessToken);
  if (channels.length === 0) return NextResponse.redirect(`${appUrl()}/unidades?erro=youtube_nochannel`);
  await connectYouTubeChannels({ prisma, cipher: getCipher() }, s.organizationId, state.unitId, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt }, channels);
  await enqueueImportNow(getQueue(), { organizationId: s.organizationId }).catch(() => undefined);
  return NextResponse.redirect(`${appUrl()}/unidades?ok=1`);
});

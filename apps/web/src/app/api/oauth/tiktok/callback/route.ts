import { exchangeTikTokCode, getTikTokUserInfo } from "@fsp/connectors";
import { enqueueImportNow } from "@fsp/queue";
import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { getCipher } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { verifyOAuthState } from "@/lib/oauth-state";
import { tiktokConfig } from "@/lib/oauth-tiktok";
import { getQueue } from "@/lib/queue";
import { prisma } from "@/lib/db";
import { connectTikTokAccount } from "@/lib/services/accounts";
import { requireSession } from "@/lib/session";

/** TikTok autoriza uma conta por vez: o callback já vincula a conta à unidade do state. */
export const GET = route(async (req: Request) => {
  const s = await requireSession();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  const state = stateToken ? await verifyOAuthState(stateToken, "tiktok") : null;
  if (!code || !state || state.organizationId !== s.organizationId) {
    return NextResponse.redirect(`${appUrl()}/unidades?erro=tiktok_state`);
  }
  const tokens = await exchangeTikTokCode(tiktokConfig(), code);
  const user = await getTikTokUserInfo(tokens.accessToken);
  await connectTikTokAccount({ prisma, cipher: getCipher() }, s.organizationId, state.unitId, tokens, user);
  await enqueueImportNow(getQueue(), { organizationId: s.organizationId }).catch(() => undefined);
  return NextResponse.redirect(`${appUrl()}/unidades?ok=1`);
});

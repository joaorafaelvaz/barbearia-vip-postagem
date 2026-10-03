import { exchangeForLongLivedToken, exchangeMetaCode } from "@fsp/connectors";
import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { getCipher } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { META_PENDING_COOKIE, metaConfig } from "@/lib/oauth-meta";
import { verifyOAuthState } from "@/lib/oauth-state";
import { requireSession } from "@/lib/session";

export const GET = route(async (req: Request) => {
  const s = await requireSession();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  const state = stateToken ? await verifyOAuthState(stateToken, "meta") : null;
  if (!code || !state || state.organizationId !== s.organizationId) {
    return NextResponse.redirect(`${appUrl()}/unidades?erro=meta_state`);
  }
  const cfg = metaConfig();
  const shortToken = await exchangeMetaCode(cfg, code);
  const longToken = await exchangeForLongLivedToken(cfg, shortToken);

  const res = NextResponse.redirect(`${appUrl()}/unidades/${state.unitId}/conectar/meta`);
  res.cookies.set(META_PENDING_COOKIE, getCipher().encrypt(longToken), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
});

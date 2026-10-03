import { exchangeGoogleCode } from "@fsp/connectors";
import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { getCipher } from "@/lib/crypto";
import { appUrl } from "@/lib/env";
import { GOOGLE_PENDING_COOKIE, googleConfig, type GooglePending } from "@/lib/oauth-google";
import { verifyOAuthState } from "@/lib/oauth-state";
import { requireSession } from "@/lib/session";

export const GET = route(async (req: Request) => {
  const s = await requireSession();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateToken = url.searchParams.get("state");
  const state = stateToken ? await verifyOAuthState(stateToken, "google") : null;
  if (!code || !state || state.organizationId !== s.organizationId) {
    return NextResponse.redirect(`${appUrl()}/unidades?erro=google_state`);
  }
  const tokens = await exchangeGoogleCode(googleConfig(), code);
  if (!tokens.refreshToken) {
    return NextResponse.redirect(`${appUrl()}/unidades?erro=google_refresh`);
  }
  const pending: GooglePending = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt.toISOString(),
  };
  const res = NextResponse.redirect(`${appUrl()}/unidades/${state.unitId}/conectar/google`);
  res.cookies.set(GOOGLE_PENDING_COOKIE, getCipher().encrypt(JSON.stringify(pending)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
});

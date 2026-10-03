import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

/**
 * `state` do OAuth assinado (anti-CSRF): carrega organização, usuário e unidade alvo,
 * expira em 10 minutos. Verificado no callback antes de aceitar o `code`.
 */
export interface OAuthState {
  organizationId: string;
  userId: string;
  unitId: string;
  provider: "meta" | "google";
  nonce: string;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(env("AUTH_SECRET"));
}

export async function signOAuthState(state: Omit<OAuthState, "nonce">): Promise<string> {
  const nonce = crypto.randomUUID();
  return new SignJWT({ ...state, nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret());
}

export async function verifyOAuthState(token: string, expectedProvider: OAuthState["provider"]): Promise<OAuthState | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.provider !== expectedProvider) return null;
    if (typeof payload.organizationId !== "string" || typeof payload.unitId !== "string") return null;
    return {
      organizationId: payload.organizationId,
      userId: String(payload.userId),
      unitId: payload.unitId,
      provider: expectedProvider,
      nonce: String(payload.nonce),
    };
  } catch {
    return null;
  }
}

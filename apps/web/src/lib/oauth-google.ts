import { appUrl, env } from "./env";

export function googleConfig() {
  return {
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    redirectUri: `${appUrl()}/api/oauth/google/callback`,
  };
}

/** Cookie temporário com os tokens (criptografados, JSON) entre o callback e a seleção de locations. */
export const GOOGLE_PENDING_COOKIE = "fsp_google_pending";

export interface GooglePending {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

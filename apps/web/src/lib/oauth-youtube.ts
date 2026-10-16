import { appUrl, env } from "./env";

/** Mesmo client OAuth do Google Meu Negócio, com redirect e escopos próprios do YouTube. */
export function youtubeConfig() {
  return {
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
    redirectUri: `${appUrl()}/api/oauth/youtube/callback`,
  };
}

import { appUrl, env } from "./env";

export function tiktokConfig() {
  return {
    clientKey: env("TIKTOK_CLIENT_KEY"),
    clientSecret: env("TIKTOK_CLIENT_SECRET"),
    redirectUri: `${appUrl()}/api/oauth/tiktok/callback`,
  };
}

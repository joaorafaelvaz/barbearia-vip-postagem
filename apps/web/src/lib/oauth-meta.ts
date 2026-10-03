import { appUrl, env } from "./env";

export function metaConfig() {
  return {
    appId: env("META_APP_ID"),
    appSecret: env("META_APP_SECRET"),
    redirectUri: `${appUrl()}/api/oauth/meta/callback`,
  };
}

/** Cookie temporário com o user token (criptografado) entre o callback e a seleção de Pages. */
export const META_PENDING_COOKIE = "fsp_meta_pending";

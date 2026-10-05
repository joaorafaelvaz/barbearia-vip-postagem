import type { Platform } from "@fsp/core";
import { FacebookPagePublisher } from "./facebook.js";
import { GoogleBusinessProfilePublisher } from "./google-business.js";
import { InstagramPublisher } from "./instagram.js";
import type { ConnectorOptions, Publisher } from "./types.js";

export * from "./types.js";
export * from "./facebook.js";
export * from "./facebook-stories.js";
export * from "./instagram.js";
export * from "./google-business.js";
export * from "./oauth/meta.js";
export * from "./oauth/google.js";
export * from "./insights.js";
export * from "./imports.js";
export { mapMetaError, mapGoogleError } from "./http.js";

/** Fábrica: devolve o Publisher da plataforma. */
export function createPublisher(platform: Platform, options: ConnectorOptions = {}): Publisher {
  switch (platform) {
    case "FACEBOOK_PAGE":
      return new FacebookPagePublisher(options);
    case "INSTAGRAM":
      return new InstagramPublisher(options);
    case "GOOGLE_BUSINESS_PROFILE":
      return new GoogleBusinessProfilePublisher(options);
  }
}

import { PublishError } from "@fsp/core";
import { defaultFetch, mapGoogleError, readJson, safeFetch } from "./http.js";
import { splitMedia, type ConnectorOptions, type PublishInput, type PublishResult, type Publisher } from "./types.js";

export const GBP_POSTS_BASE = "https://mybusiness.googleapis.com/v4";

/**
 * Publica um Local Post (tipo STANDARD) em uma location do Google Business Profile.
 * `account.externalId` = `accounts/{accountId}/locations/{locationId}`.
 * `account.accessToken` = access token OAuth válido (renovado pelo chamador).
 */
export class GoogleBusinessProfilePublisher implements Publisher {
  readonly platform = "GOOGLE_BUSINESS_PROFILE" as const;
  private readonly fetch;

  constructor(options: ConnectorOptions = {}) {
    this.fetch = options.fetch ?? defaultFetch;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const { account, caption } = input;
    const { images, video } = splitMedia(input.media);
    if (input.format && input.format !== "FEED") {
      throw new PublishError("VALIDATION", "Google Business Profile não aceita Story nem Reel.");
    }
    if (video) {
      throw new PublishError("VALIDATION", "Google Business Profile não aceita vídeo em postagens via API.");
    }
    if (!/^accounts\/[^/]+\/locations\/[^/]+$/.test(account.externalId)) {
      throw new PublishError("VALIDATION", `Location inválida: ${account.externalId}`);
    }
    const payload: Record<string, unknown> = {
      languageCode: "pt-BR",
      summary: caption,
      topicType: "STANDARD",
    };
    if (images.length > 0) {
      payload.media = images.map((sourceUrl) => ({ mediaFormat: "PHOTO", sourceUrl }));
    }

    const res = await safeFetch(this.fetch, `${GBP_POSTS_BASE}/${account.externalId}/localPosts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = (await readJson(res)) as Record<string, unknown> | undefined;
    if (!res.ok) throw mapGoogleError(res.status, body, res.headers.get("retry-after"));

    const name = body?.name;
    if (typeof name !== "string") throw new PublishError("UNKNOWN", "localPosts.create não retornou name.");
    const searchUrl = typeof body?.searchUrl === "string" ? body.searchUrl : undefined;
    return searchUrl ? { externalPostId: name, externalUrl: searchUrl } : { externalPostId: name };
  }
}

import { PublishError } from "@fsp/core";
import { defaultFetch, formBody, mapMetaError, readJson, safeFetch } from "./http.js";
import type { ConnectorOptions, PublishInput, PublishResult, Publisher } from "./types.js";

export const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v21.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

/**
 * Publica em uma Facebook Page usando Page Access Token.
 * - Só texto: POST /{page-id}/feed {message}
 * - 1 imagem: POST /{page-id}/photos {url, message}
 * - N imagens: POST /{page-id}/photos {url, published=false} para cada,
 *   depois POST /{page-id}/feed {message, attached_media[i]={media_fbid}}
 */
export class FacebookPagePublisher implements Publisher {
  readonly platform = "FACEBOOK_PAGE" as const;
  private readonly fetch;

  constructor(options: ConnectorOptions = {}) {
    this.fetch = options.fetch ?? defaultFetch;
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const { account, caption, mediaUrls } = input;
    const pageId = account.externalId;
    const token = account.accessToken;

    if (mediaUrls.length === 0) {
      const id = await this.post(`${GRAPH_BASE}/${pageId}/feed`, { message: caption, access_token: token });
      return { externalPostId: id, externalUrl: `https://www.facebook.com/${id}` };
    }

    if (mediaUrls.length === 1) {
      const body = await this.postJson(`${GRAPH_BASE}/${pageId}/photos`, {
        url: mediaUrls[0],
        message: caption,
        access_token: token,
      });
      const postId = (body.post_id as string | undefined) ?? (body.id as string);
      return { externalPostId: postId, externalUrl: `https://www.facebook.com/${postId}` };
    }

    const fbids: string[] = [];
    for (const url of mediaUrls) {
      const id = await this.post(`${GRAPH_BASE}/${pageId}/photos`, {
        url,
        published: "false",
        access_token: token,
      });
      fbids.push(id);
    }
    const fields: Record<string, string> = { message: caption, access_token: token };
    fbids.forEach((fbid, i) => {
      fields[`attached_media[${i}]`] = JSON.stringify({ media_fbid: fbid });
    });
    const id = await this.post(`${GRAPH_BASE}/${pageId}/feed`, fields);
    return { externalPostId: id, externalUrl: `https://www.facebook.com/${id}` };
  }

  private async post(url: string, fields: Record<string, string | undefined>): Promise<string> {
    const body = await this.postJson(url, fields);
    const id = body.id;
    if (typeof id !== "string") throw new PublishError("UNKNOWN", "Graph API não retornou id.");
    return id;
  }

  private async postJson(url: string, fields: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    const res = await safeFetch(this.fetch, url, { method: "POST", body: formBody(fields) });
    const body = await readJson(res);
    if (!res.ok) throw mapMetaError(res.status, body);
    return (body ?? {}) as Record<string, unknown>;
  }
}

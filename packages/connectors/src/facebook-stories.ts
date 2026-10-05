import { PublishError } from "@fsp/core";
import { GRAPH_BASE, GRAPH_VERSION } from "./facebook.js";
import { formBody, mapMetaError, readJson, safeFetch } from "./http.js";
import type { FetchLike, PublishResult } from "./types.js";

/**
 * Facebook Page: Stories e Reels usam upload em fases:
 * 1. POST /{page-id}/video_stories|video_reels?upload_phase=start -> {video_id, upload_url}
 * 2. POST upload_url com header file_url (a Meta baixa o vídeo da URL pública)
 * 3. POST /{page-id}/video_stories|video_reels?upload_phase=finish&video_id=...
 * Story de foto: foto não publicada em /{page-id}/photos e depois POST /{page-id}/photo_stories.
 */
export const RUPLOAD_BASE = `https://rupload.facebook.com/video-upload/${GRAPH_VERSION}`;

type Kind = "video_stories" | "video_reels";

async function postForm(f: FetchLike, url: string, fields: Record<string, string | undefined>): Promise<Record<string, unknown>> {
  const res = await safeFetch(f, url, { method: "POST", body: formBody(fields) });
  const body = await readJson(res);
  if (!res.ok) throw mapMetaError(res.status, body);
  return (body ?? {}) as Record<string, unknown>;
}

async function uploadByUrl(f: FetchLike, uploadUrl: string, fileUrl: string, token: string): Promise<void> {
  const res = await safeFetch(f, uploadUrl, {
    method: "POST",
    headers: { Authorization: `OAuth ${token}`, file_url: fileUrl },
  });
  const body = await readJson(res);
  if (!res.ok) throw mapMetaError(res.status, body);
  const ok = (body as { success?: unknown } | undefined)?.success;
  if (ok === false) throw new PublishError("MEDIA_REJECTED", "A Meta não conseguiu baixar o vídeo da URL informada.");
}

export async function publishFacebookVideoPhased(
  f: FetchLike,
  kind: Kind,
  pageId: string,
  token: string,
  videoUrl: string,
  description: string,
): Promise<PublishResult> {
  const start = await postForm(f, `${GRAPH_BASE}/${pageId}/${kind}`, { upload_phase: "start", access_token: token });
  const videoId = start.video_id;
  const uploadUrl = start.upload_url;
  if (typeof videoId !== "string" || typeof uploadUrl !== "string") throw new PublishError("UNKNOWN", `Fase start de ${kind} sem video_id/upload_url.`);
  await uploadByUrl(f, uploadUrl, videoUrl, token);
  const finish = await postForm(f, `${GRAPH_BASE}/${pageId}/${kind}`, {
    upload_phase: "finish",
    video_id: videoId,
    access_token: token,
    ...(kind === "video_reels" ? { video_state: "PUBLISHED", description } : {}),
  });
  const postId = typeof finish.post_id === "string" ? finish.post_id : videoId;
  return kind === "video_reels"
    ? { externalPostId: videoId, externalUrl: `https://www.facebook.com/reel/${videoId}` }
    : { externalPostId: postId };
}

export async function publishFacebookPhotoStory(f: FetchLike, pageId: string, token: string, imageUrl: string): Promise<PublishResult> {
  const photo = await postForm(f, `${GRAPH_BASE}/${pageId}/photos`, { url: imageUrl, published: "false", access_token: token });
  const photoId = photo.id;
  if (typeof photoId !== "string") throw new PublishError("UNKNOWN", "Upload da foto do story não retornou id.");
  const story = await postForm(f, `${GRAPH_BASE}/${pageId}/photo_stories`, { photo_id: photoId, access_token: token });
  const postId = typeof story.post_id === "string" ? story.post_id : photoId;
  return { externalPostId: postId };
}

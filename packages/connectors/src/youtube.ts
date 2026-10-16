import { PublishError, youtubeTitleFromCaption } from "@fsp/core";
import { defaultFetch, mapGoogleError, readJson, safeFetch } from "./http.js";
import type { ConnectorOptions, FetchLike, Publisher, PublishInput, PublishResult } from "./types.js";
import { splitMedia } from "./types.js";

export const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const DESCRIPTION_LIMIT = 5_000;

export type YouTubePrivacy = "public" | "private" | "unlisted";

/**
 * Upload de vídeo no YouTube (Data API v3, upload resumável): o worker baixa o vídeo da
 * nossa URL e envia os bytes em streaming. Cada upload custa 1600 unidades da cota diária
 * (10.000 por padrão, ~6 vídeos/dia por projeto Google). Vídeos verticais de até 3min viram
 * Shorts automaticamente. Apps Google não verificados publicam como privado.
 */
export class YouTubePublisher implements Publisher {
  readonly platform = "YOUTUBE" as const;
  private readonly fetch: FetchLike;
  private readonly privacy: YouTubePrivacy;

  constructor(options: ConnectorOptions = {}) {
    this.fetch = options.fetch ?? defaultFetch;
    this.privacy = options.youtubePrivacyStatus ?? "public";
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const { images, video } = splitMedia(input.media);
    const format = input.format ?? "FEED";
    if (format === "STORY") throw new PublishError("VALIDATION", "YouTube não aceita Story.");
    if (!video) throw new PublishError("VALIDATION", "YouTube exige um vídeo.");
    if (images.length > 0) throw new PublishError("VALIDATION", "YouTube não aceita imagens.");
    const token = input.account.accessToken;

    // 1) Baixa o vídeo da nossa URL pública (streaming quando o tamanho é conhecido).
    const src = await safeFetch(this.fetch, video);
    if (!src.ok) throw new PublishError("MEDIA_REJECTED", `Não foi possível baixar o vídeo para enviar ao YouTube (HTTP ${src.status}).`);
    let size = Number(src.headers.get("content-length") ?? 0);
    let body: RequestInit["body"];
    if (size > 0 && src.body) {
      body = src.body;
    } else {
      const buf = await src.arrayBuffer();
      size = buf.byteLength;
      body = buf;
    }
    if (size === 0) throw new PublishError("MEDIA_REJECTED", "O arquivo de vídeo está vazio.");
    const contentType = (src.headers.get("content-type") ?? "video/mp4").split(";")[0]?.trim() || "video/mp4";

    // 2) Abre a sessão de upload resumável com os metadados.
    const description = [...input.caption].slice(0, DESCRIPTION_LIMIT).join("");
    const snippet: Record<string, unknown> = { title: youtubeTitleFromCaption(input.caption), description };
    if (format === "REEL") snippet.tags = ["Shorts"];
    const init = await safeFetch(this.fetch, UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": contentType,
      },
      body: JSON.stringify({ snippet, status: { privacyStatus: this.privacy, selfDeclaredMadeForKids: false } }),
    });
    if (!init.ok) throw mapGoogleError(init.status, await readJson(init), init.headers.get("retry-after"));
    const location = init.headers.get("location");
    if (!location) throw new PublishError("UNKNOWN", "YouTube não devolveu a URL da sessão de upload.");

    // 3) Envia os bytes.
    const up = await safeFetch(this.fetch, location, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType, "Content-Length": String(size) },
      body,
      duplex: "half",
    } as RequestInit);
    const result = (await readJson(up)) as { id?: string } | undefined;
    if (!up.ok) throw mapGoogleError(up.status, result, up.headers.get("retry-after"));
    if (!result?.id) throw new PublishError("UNKNOWN", "YouTube não devolveu o id do vídeo.");
    return { externalPostId: result.id, externalUrl: `https://youtu.be/${result.id}` };
  }
}

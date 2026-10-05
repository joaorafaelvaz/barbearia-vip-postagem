import type { MediaKind, Platform, PostFormat } from "@fsp/core";

/** Dados mínimos de uma conta para publicar. O token já vem descriptografado. */
export interface AccountCredentials {
  platform: Platform;
  /** Page ID, IG User ID ou `accounts/{a}/locations/{l}` */
  externalId: string;
  accessToken: string;
}

/** Mídia pública referenciada por URL. */
export interface MediaRef {
  url: string;
  kind: MediaKind;
}

export interface PublishInput {
  account: AccountCredentials;
  /** FEED (padrão), STORY ou REEL */
  format?: PostFormat;
  caption: string;
  /** Mídias públicas, em ordem. Um post tem só imagens ou um único vídeo. */
  media: readonly MediaRef[];
}

export interface PublishResult {
  externalPostId: string;
  externalUrl?: string;
}

export interface Publisher {
  readonly platform: Platform;
  publish(input: PublishInput): Promise<PublishResult>;
}

/** `fetch` injetável para testes. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ConnectorOptions {
  fetch?: FetchLike;
  /** Para o polling do container do Instagram. */
  sleep?: (ms: number) => Promise<void>;
}

export function splitMedia(media: readonly MediaRef[]): { images: string[]; video: string | undefined } {
  const images = media.filter((m) => m.kind === "IMAGE").map((m) => m.url);
  const video = media.find((m) => m.kind === "VIDEO")?.url;
  return { images, video };
}

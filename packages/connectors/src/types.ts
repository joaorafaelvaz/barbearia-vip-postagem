import type { Platform } from "@fsp/core";

/** Dados mínimos de uma conta para publicar. O token já vem descriptografado. */
export interface AccountCredentials {
  platform: Platform;
  /** Page ID, IG User ID ou `accounts/{a}/locations/{l}` */
  externalId: string;
  accessToken: string;
}

export interface PublishInput {
  account: AccountCredentials;
  caption: string;
  /** URLs públicas das imagens, em ordem. */
  mediaUrls: readonly string[];
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

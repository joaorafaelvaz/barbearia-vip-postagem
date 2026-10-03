/**
 * Erros tipados de publicação. O worker usa `retryable` para decidir
 * entre backoff (transitório) e falha definitiva (permanente).
 */
export type PublishErrorCode =
  | "RATE_LIMITED"
  | "INVALID_TOKEN"
  | "PERMISSION_DENIED"
  | "MEDIA_REJECTED"
  | "VALIDATION"
  | "NETWORK"
  | "UPSTREAM_UNAVAILABLE"
  | "UNKNOWN";

const RETRYABLE: Record<PublishErrorCode, boolean> = {
  RATE_LIMITED: true,
  INVALID_TOKEN: false,
  PERMISSION_DENIED: false,
  MEDIA_REJECTED: false,
  VALIDATION: false,
  NETWORK: true,
  UPSTREAM_UNAVAILABLE: true,
  UNKNOWN: true,
};

export class PublishError extends Error {
  readonly code: PublishErrorCode;
  readonly retryable: boolean;
  /** Segundos sugeridos até a próxima tentativa, quando a API informa. */
  readonly retryAfterSeconds: number | undefined;
  readonly upstreamStatus: number | undefined;

  constructor(
    code: PublishErrorCode,
    message: string,
    options: { retryAfterSeconds?: number; upstreamStatus?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "PublishError";
    this.code = code;
    this.retryable = RETRYABLE[code];
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.upstreamStatus = options.upstreamStatus;
  }

  /** Representação segura para gravar em `PostTarget.lastError` (sem tokens). */
  toPersisted(): string {
    return `[${this.code}] ${this.message}`;
  }
}

export function isPublishError(err: unknown): err is PublishError {
  return err instanceof PublishError;
}

/** Converte qualquer erro em PublishError, preservando classificação quando possível. */
export function toPublishError(err: unknown): PublishError {
  if (isPublishError(err)) return err;
  if (err instanceof TypeError && /fetch/i.test(err.message)) {
    return new PublishError("NETWORK", "Falha de rede ao chamar a API.", { cause: err });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new PublishError("UNKNOWN", message, { cause: err });
}

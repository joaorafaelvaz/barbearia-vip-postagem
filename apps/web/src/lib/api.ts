import { PublishError } from "@fsp/core";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { UnauthorizedError } from "./session";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const PLATFORM_STATUS: Partial<Record<PublishError["code"], number>> = {
  VALIDATION: 400,
  MEDIA_REJECTED: 400,
  INVALID_TOKEN: 409,
  PERMISSION_DENIED: 403,
  RATE_LIMITED: 429,
  NETWORK: 502,
  UPSTREAM_UNAVAILABLE: 503,
  UNKNOWN: 502,
};

/** Envolve um handler de rota convertendo erros conhecidos em respostas JSON. */
export function route<T extends unknown[]>(handler: (...args: T) => Promise<Response>) {
  return async (...args: T): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
      if (err instanceof HttpError) {
        return NextResponse.json({ error: err.message, details: err.details ?? null }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json({ error: "Dados inválidos", details: err.flatten() }, { status: 400 });
      }
      if (err instanceof PublishError) {
        // Erro vindo da plataforma (Meta/Google): devolve o motivo em vez de "Erro interno".
        console.error("[api] erro da plataforma", { code: err.code, upstreamStatus: err.upstreamStatus, message: err.message });
        return NextResponse.json({ error: `[${err.code}] ${err.message}`, code: err.code }, { status: PLATFORM_STATUS[err.code] ?? 502 });
      }
      console.error(err);
      return NextResponse.json({ error: "Erro interno" }, { status: 500 });
    }
  };
}

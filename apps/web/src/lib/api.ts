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
      console.error(err);
      return NextResponse.json({ error: "Erro interno" }, { status: 500 });
    }
  };
}

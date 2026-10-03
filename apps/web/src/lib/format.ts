import { PLATFORM_LABELS, utcToLocal, type Platform } from "@fsp/core";

export const STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Agendado",
  PUBLISHING: "Publicando",
  PUBLISHED: "Publicado",
  FAILED: "Falhou",
  CANCELLED: "Cancelado",
};

export function platformLabel(p: string): string {
  return PLATFORM_LABELS[p as Platform] ?? p;
}

/** `2026-10-15T09:30` -> `15/10/2026 09:30` */
export function formatLocal(local: string): string {
  const [date, time] = local.split("T");
  const [y, m, d] = (date ?? "").split("-");
  return `${d}/${m}/${y} ${time ?? ""}`.trim();
}

export function formatInTz(date: Date, timeZone: string): string {
  return formatLocal(utcToLocal(date, timeZone));
}

/** Encurta um texto para exibição em tabelas. */
export function shorten(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

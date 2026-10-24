// Subpaths, não a raiz "@fsp/core": este módulo entra em componentes client (NoticeList/NoticeComposer)
// e a raiz puxa `crypto.ts` (node:crypto), que o bundle do navegador não resolve.
import { PLATFORM_LABELS, type Platform } from "@fsp/core/platforms";
import { utcToLocal } from "@fsp/core/timezone";

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

/** Estados dos Avisos WhatsApp -> rótulo e classe de `.badge` reaproveitada. */
export const NOTICE_STATE_LABELS: Record<string, { label: string; badge: string }> = {
  ativo: { label: "Ativo", badge: "SCHEDULED" },
  pausado: { label: "Pausado", badge: "FAILED" },
  enviando: { label: "Enviando", badge: "PUBLISHING" },
  concluido: { label: "Concluído", badge: "PUBLISHED" },
  cancelado: { label: "Cancelado", badge: "CANCELLED" },
};
export const DELIVERY_STATUS_LABELS: Record<string, { label: string; badge: string }> = {
  enviado: { label: "Enviado", badge: "PUBLISHED" },
  falhou: { label: "Falhou", badge: "FAILED" },
  perdido: { label: "Perdido", badge: "CANCELLED" },
  pausado: { label: "Pausado", badge: "PUBLISHING" },
};
export const RECURRENCE_LABELS: Record<string, string> = { nenhuma: "Única", diaria: "Diária", semanal: "Semanal", mensal: "Mensal" };
/** 0 = segunda ... 6 = domingo (mesma convenção de `nextOccurrence` e do daily). */
export const WEEKDAYS_PT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export function describeRecurrence(rec: { tipo: string; dias?: number[]; dia?: number | string }): string {
  if (rec.tipo === "semanal") return `Semanal (${(rec.dias ?? []).map((d) => WEEKDAYS_PT[d] ?? String(d)).join(", ")})`;
  if (rec.tipo === "mensal") return `Mensal (dia ${rec.dia === "ultimo" ? "último" : rec.dia})`;
  return RECURRENCE_LABELS[rec.tipo] ?? rec.tipo;
}

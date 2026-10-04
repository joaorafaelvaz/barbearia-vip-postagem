/** Funções puras do Analytics (testáveis sem banco). */

export interface DayPoint { day: string; published: number; failed: number }

/** `YYYY-MM-DD` no fuso informado. */
export function dayKey(date: Date, timeZone: string): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Série diária contínua (dias sem dados ficam em zero). */
export function dailySeries(items: Array<{ at: Date; ok: boolean; timeZone: string }>, from: Date, to: Date, timeZone: string): DayPoint[] {
  const map = new Map<string, DayPoint>();
  for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
    const k = dayKey(new Date(t), timeZone);
    if (!map.has(k)) map.set(k, { day: k, published: 0, failed: 0 });
  }
  for (const it of items) {
    const k = dayKey(it.at, it.timeZone);
    const row = map.get(k) ?? { day: k, published: 0, failed: 0 };
    if (it.ok) row.published++;
    else row.failed++;
    map.set(k, row);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Extrai o código de `[CODE] mensagem` gravado em lastError. */
export function errorCode(lastError: string | null | undefined): string {
  const m = /^\[([A-Z_]+)\]/.exec(lastError ?? "");
  return m?.[1] ?? "UNKNOWN";
}

export const ERROR_LABELS: Record<string, string> = {
  INVALID_TOKEN: "Token inválido ou expirado (reconecte a conta)",
  PERMISSION_DENIED: "Sem permissão na plataforma",
  RATE_LIMITED: "Limite de publicações atingido",
  MEDIA_REJECTED: "Mídia rejeitada pela plataforma",
  VALIDATION: "Conteúdo inválido para a plataforma",
  NETWORK: "Falha de rede",
  UPSTREAM_UNAVAILABLE: "Plataforma indisponível",
  UNKNOWN: "Erro não classificado",
};

export function successRate(published: number, failed: number): number {
  const total = published + failed;
  return total === 0 ? 0 : Math.round((published / total) * 100);
}

export function engagementScore(m: { likes: number; comments: number; shares: number; saves: number }): number {
  return m.likes + m.comments * 2 + m.shares * 3 + m.saves * 2;
}

export function formatCompact(n: number): string {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

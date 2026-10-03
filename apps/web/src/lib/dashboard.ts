/** Helpers puros do painel (mês de referência, navegação). */

export interface MonthRange {
  start: Date;
  end: Date;
  label: string;
  key: string;
}

export function monthRange(mes: string | undefined, now: Date = new Date()): MonthRange {
  const fallback = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const [y, m] = (mes && /^\d{4}-\d{2}$/.test(mes) ? mes : fallback).split("-").map(Number);
  const year = y ?? now.getUTCFullYear();
  const month = (m ?? now.getUTCMonth() + 1) - 1;
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(start);
  return { start, end, label, key: `${year}-${String(month + 1).padStart(2, "0")}` };
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Células do calendário: nulls para alinhar o 1º dia ao dia da semana, depois `YYYY-MM-DD`. */
export function calendarCells(range: MonthRange): Array<string | null> {
  const firstDow = range.start.getUTCDay();
  const daysInMonth = new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth() + 1, 0)).getUTCDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => `${range.key}-${String(i + 1).padStart(2, "0")}`);
  return [...(Array(firstDow).fill(null) as null[]), ...days];
}

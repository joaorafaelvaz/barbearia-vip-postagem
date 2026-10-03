/**
 * Conversão entre horário local de uma unidade (fuso IANA) e UTC, sem dependências.
 * A UI envia `YYYY-MM-DDTHH:mm` (sem offset) + o fuso da unidade.
 */

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function partsAt(utcMs: number, timeZone: string, withSeconds: boolean): Record<string, string> {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
  });
  return Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
}

/** Offset (ms) do fuso em um instante UTC. Positivo a leste de Greenwich. */
function offsetAt(utcMs: number, timeZone: string): number {
  const p = partsAt(utcMs, timeZone, true);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - utcMs;
}

/**
 * Converte um horário local (`2026-10-15T09:30`) no fuso informado para um Date UTC.
 * Faz duas passadas de offset para convergir em transições de horário de verão.
 */
export function localToUtc(local: string, timeZone: string): Date {
  const m = LOCAL_RE.exec(local);
  if (!m) throw new Error(`Horário local inválido: ${local}`);
  if (!isValidTimeZone(timeZone)) throw new Error(`Fuso horário inválido: ${timeZone}`);
  const [, y, mo, d, h, mi, s] = m;
  const wall = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  let utc = wall - offsetAt(wall, timeZone);
  utc = wall - offsetAt(utc, timeZone);
  return new Date(utc);
}

/** Formata um instante UTC como `YYYY-MM-DDTHH:mm` no fuso informado. */
export function utcToLocal(date: Date, timeZone: string): string {
  const p = partsAt(date.getTime(), timeZone, false);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

import { PublishError } from "@fsp/core";
import { defaultFetch, mapGoogleError, readJson, safeFetch } from "./http.js";
import type { AccountCredentials, ConnectorOptions } from "./types.js";

export const GBP_PERFORMANCE_BASE = "https://businessprofileperformance.googleapis.com/v1";

/** Métricas diárias do perfil que o Google ainda fornece (Business Profile Performance API). */
export const PROFILE_DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "WEBSITE_CLICKS",
  "CALL_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "MESSAGING_CLICKS",
  "BUSINESS_BOOKINGS",
] as const;

/** Um dia de desempenho do perfil (datas no calendário do Google, sem fuso). */
export interface ProfileDailyPoint {
  /** YYYY-MM-DD */
  date: string;
  impressionsSearch: number;
  impressionsMaps: number;
  websiteClicks: number;
  callClicks: number;
  directionRequests: number;
  messagingClicks: number;
  bookings: number;
}

export const emptyProfilePoint = (date: string): ProfileDailyPoint => ({
  date, impressionsSearch: 0, impressionsMaps: 0, websiteClicks: 0, callClicks: 0, directionRequests: 0, messagingClicks: 0, bookings: 0,
});

type DailyMetric = (typeof PROFILE_DAILY_METRICS)[number];
const FIELD: Record<DailyMetric, keyof Omit<ProfileDailyPoint, "date">> = {
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "impressionsSearch",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "impressionsSearch",
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "impressionsMaps",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "impressionsMaps",
  WEBSITE_CLICKS: "websiteClicks",
  CALL_CLICKS: "callClicks",
  BUSINESS_DIRECTION_REQUESTS: "directionRequests",
  MESSAGING_CLICKS: "messagingClicks",
  BUSINESS_BOOKINGS: "bookings",
};

/** `accounts/{a}/locations/{l}` -> `locations/{l}` (a Performance API usa só o id da location). */
export function performanceLocationName(externalId: string): string {
  const m = /locations\/([^/]+)$/.exec(externalId);
  if (!m) throw new PublishError("VALIDATION", `Location inválida: ${externalId}`);
  return `locations/${m[1]}`;
}

const ymd = (d: Date) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Busca as métricas diárias do perfil entre `from` e `to` (datas UTC, inclusivas).
 * O Google não fornece mais métricas por postagem; estas são do perfil inteiro.
 */
export class GoogleBusinessPerformanceClient {
  private readonly http;
  constructor(o: ConnectorOptions = {}) {
    this.http = o.fetch ?? defaultFetch;
  }

  async fetchDaily(account: AccountCredentials, from: Date, to: Date): Promise<ProfileDailyPoint[]> {
    const params = new URLSearchParams();
    for (const m of PROFILE_DAILY_METRICS) params.append("dailyMetrics", m);
    const s = ymd(from);
    const e = ymd(to);
    params.set("dailyRange.start_date.year", String(s.year));
    params.set("dailyRange.start_date.month", String(s.month));
    params.set("dailyRange.start_date.day", String(s.day));
    params.set("dailyRange.end_date.year", String(e.year));
    params.set("dailyRange.end_date.month", String(e.month));
    params.set("dailyRange.end_date.day", String(e.day));
    const url = `${GBP_PERFORMANCE_BASE}/${performanceLocationName(account.externalId)}:fetchMultiDailyMetricsTimeSeries?${params}`;
    const res = await safeFetch(this.http, url, { headers: { Authorization: `Bearer ${account.accessToken}` } });
    const body = (await readJson(res)) as Record<string, unknown> | undefined;
    if (!res.ok) throw mapGoogleError(res.status, body, res.headers.get("retry-after"));

    type Dated = { date?: { year?: number; month?: number; day?: number }; value?: unknown };
    type Series = { dailyMetric?: string; timeSeries?: { datedValues?: Dated[] } };
    type Multi = { dailyMetricTimeSeries?: Series[] };
    const byDate = new Map<string, ProfileDailyPoint>();
    for (const multi of (body?.multiDailyMetricTimeSeries as Multi[] | undefined) ?? []) {
      for (const series of multi.dailyMetricTimeSeries ?? []) {
        const field = FIELD[series.dailyMetric as DailyMetric];
        if (!field) continue;
        for (const dv of series.timeSeries?.datedValues ?? []) {
          const d = dv.date;
          if (!d?.year || !d.month || !d.day) continue;
          const key = `${d.year}-${pad(d.month)}-${pad(d.day)}`;
          const point = byDate.get(key) ?? emptyProfilePoint(key);
          point[field] += Number(dv.value ?? 0) || 0;
          byDate.set(key, point);
        }
      }
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
}

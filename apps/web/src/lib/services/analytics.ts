import type { PrismaClient } from "@fsp/db";
import { ERROR_LABELS, dailySeries, engagementScore, errorCode, successRate, type DayPoint } from "../analytics-utils";

export interface AnalyticsFilters {
  days: 7 | 30 | 90;
  unitId?: string;
  platform?: string;
}

export interface Engagement { likes: number; comments: number; shares: number; reach: number; impressions: number; saves: number; clicks: number }

export interface AnalyticsData {
  range: { from: Date; to: Date; days: number };
  totals: { published: number; failed: number; scheduled: number; cancelled: number; successRate: number; imported: number };
  engagement: Engagement;
  metricsCoverage: { withMetrics: number; partial: number; lastFetchedAt: Date | null };
  series: DayPoint[];
  byUnit: Array<{ unitId: string; name: string; published: number; failed: number } & Engagement>;
  byPlatform: Array<{ platform: string; published: number; failed: number } & Engagement>;
  topPosts: Array<{ targetId: string; postId: string | null; source: "system" | "external"; caption: string; unit: string; platform: string; externalUrl: string | null; publishedAt: Date | null; score: number } & Engagement>;
  failures: Array<{ code: string; label: string; count: number }>;
  /** Desempenho do perfil no Google Meu Negócio; null quando o filtro de plataforma exclui o Google. */
  profile: ProfileAnalytics | null;
}

export interface ProfileTotals { impressionsSearch: number; impressionsMaps: number; websiteClicks: number; callClicks: number; directionRequests: number; messagingClicks: number; bookings: number }

export interface ProfileAnalytics {
  accounts: number;
  totals: ProfileTotals;
  byUnit: Array<{ accountId: string; unit: string; account: string; days: number } & ProfileTotals>;
  errors: Array<{ accountId: string; unit: string; account: string; message: string }>;
  lastFetchedAt: Date | null;
  /** último dia com dados (dd/mm/aaaa) */
  lastDay: string | null;
}

const zeroProfile = (): ProfileTotals => ({ impressionsSearch: 0, impressionsMaps: 0, websiteClicks: 0, callClicks: 0, directionRequests: 0, messagingClicks: 0, bookings: 0 });
const PROFILE_KEYS: Array<keyof ProfileTotals> = ["impressionsSearch", "impressionsMaps", "websiteClicks", "callClicks", "directionRequests", "messagingClicks", "bookings"];

/** Soma o desempenho diário dos perfis do Google no período (dias do calendário do Google, em UTC). */
async function getProfileAnalytics(prisma: PrismaClient, organizationId: string, allowed: string[] | null, f: AnalyticsFilters, from: Date): Promise<ProfileAnalytics | null> {
  if (f.platform && f.platform !== "GOOGLE_BUSINESS_PROFILE") return null;
  const fromDay = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const accounts = await prisma.connectedAccount.findMany({
    where: { organizationId, platform: "GOOGLE_BUSINESS_PROFILE", isActive: true, ...(f.unitId ? { unitId: f.unitId } : allowed ? { unitId: { in: allowed } } : {}) },
    select: {
      id: true, displayName: true, profileMetricsAt: true, profileMetricsError: true,
      unit: { select: { name: true } },
      profileMetrics: { where: { date: { gte: fromDay } }, select: { date: true, impressionsSearch: true, impressionsMaps: true, websiteClicks: true, callClicks: true, directionRequests: true, messagingClicks: true, bookings: true } },
    },
    orderBy: [{ unit: { name: "asc" } }, { displayName: "asc" }],
  });
  const out: ProfileAnalytics = { accounts: accounts.length, totals: zeroProfile(), byUnit: [], errors: [], lastFetchedAt: null, lastDay: null };
  let lastDay: Date | null = null;
  for (const a of accounts) {
    const row = { accountId: a.id, unit: a.unit.name, account: a.displayName, days: a.profileMetrics.length, ...zeroProfile() };
    for (const d of a.profileMetrics) {
      for (const k of PROFILE_KEYS) { row[k] += d[k]; out.totals[k] += d[k]; }
      if (!lastDay || d.date > lastDay) lastDay = d.date;
    }
    out.byUnit.push(row);
    if (a.profileMetricsError) out.errors.push({ accountId: a.id, unit: a.unit.name, account: a.displayName, message: a.profileMetricsError });
    if (a.profileMetricsAt && (!out.lastFetchedAt || a.profileMetricsAt > out.lastFetchedAt)) out.lastFetchedAt = a.profileMetricsAt;
  }
  if (lastDay) out.lastDay = `${String(lastDay.getUTCDate()).padStart(2, "0")}/${String(lastDay.getUTCMonth() + 1).padStart(2, "0")}/${lastDay.getUTCFullYear()}`;
  out.byUnit.sort((x, y) => y.impressionsSearch + y.impressionsMaps - (x.impressionsSearch + x.impressionsMaps));
  return out;
}

const zero = (): Engagement => ({ likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0, saves: 0, clicks: 0 });
const ENGAGEMENT_KEYS: Array<keyof Engagement> = ["likes", "comments", "shares", "reach", "impressions", "saves", "clicks"];
/** Soma só os campos de engajamento (o alvo pode ter outros campos, como nome e id). */
const add = (a: Engagement, m: Engagement) => { for (const k of ENGAGEMENT_KEYS) a[k] += m[k]; };

export async function getAnalytics(prisma: PrismaClient, organizationId: string, allowed: string[] | null, f: AnalyticsFilters, timeZone = "America/Sao_Paulo"): Promise<AnalyticsData> {
  const to = new Date();
  const from = new Date(to.getTime() - f.days * 86_400_000);
  const accountFilter = {
    ...(f.unitId ? { unitId: f.unitId } : allowed ? { unitId: { in: allowed } } : {}),
    ...(f.platform ? { platform: f.platform as never } : {}),
  };
  const targets = await prisma.postTarget.findMany({
    where: { organizationId, scheduledAt: { gte: from }, ...(Object.keys(accountFilter).length ? { account: accountFilter } : {}) },
    include: { metrics: true, post: { select: { id: true, caption: true } }, account: { select: { platform: true, unit: { select: { id: true, name: true, timezone: true } } } } },
  });

  const totals = { published: 0, failed: 0, scheduled: 0, cancelled: 0, successRate: 0, imported: 0 };
  const engagement = zero();
  const coverage = { withMetrics: 0, partial: 0, lastFetchedAt: null as Date | null };
  const units = new Map<string, AnalyticsData["byUnit"][number]>();
  const platforms = new Map<string, AnalyticsData["byPlatform"][number]>();
  const failures = new Map<string, number>();
  const top: AnalyticsData["topPosts"] = [];
  const seriesItems: Array<{ at: Date; ok: boolean; timeZone: string }> = [];

  for (const t of targets) {
    const u = units.get(t.account.unit.id) ?? { unitId: t.account.unit.id, name: t.account.unit.name, published: 0, failed: 0, ...zero() };
    const p = platforms.get(t.account.platform) ?? { platform: t.account.platform, published: 0, failed: 0, ...zero() };
    if (t.status === "PUBLISHED") {
      totals.published++; u.published++; p.published++;
      seriesItems.push({ at: t.publishedAt ?? t.scheduledAt, ok: true, timeZone: t.account.unit.timezone });
      if (t.metrics) {
        coverage.withMetrics++;
        // Google não tem métricas por postagem: não é "parcial" por falta de permissão.
        if (t.metrics.partial && t.account.platform !== "GOOGLE_BUSINESS_PROFILE") coverage.partial++;
        if (!coverage.lastFetchedAt || t.metrics.fetchedAt > coverage.lastFetchedAt) coverage.lastFetchedAt = t.metrics.fetchedAt;
        const m = { likes: t.metrics.likes, comments: t.metrics.comments, shares: t.metrics.shares, reach: t.metrics.reach, impressions: t.metrics.impressions, saves: t.metrics.saves, clicks: t.metrics.clicks };
        add(engagement, m); add(u, m); add(p, m);
        top.push({ targetId: t.id, postId: t.post.id, source: "system", caption: t.post.caption, unit: t.account.unit.name, platform: t.account.platform, externalUrl: t.externalUrl, publishedAt: t.publishedAt, score: engagementScore(m), ...m });
      }
    } else if (t.status === "FAILED") {
      totals.failed++; u.failed++; p.failed++;
      seriesItems.push({ at: t.scheduledAt, ok: false, timeZone: t.account.unit.timezone });
      const code = errorCode(t.lastError);
      failures.set(code, (failures.get(code) ?? 0) + 1);
    } else if (t.status === "CANCELLED") totals.cancelled++;
    else totals.scheduled++;
    units.set(u.unitId, u);
    platforms.set(p.platform, p);
  }
  // Publicações importadas das plataformas (feitas fora do sistema)
  const externals = await prisma.externalPost.findMany({
    where: { organizationId, publishedAt: { gte: from }, ...(Object.keys(accountFilter).length ? { account: accountFilter } : {}) },
    include: { account: { select: { platform: true, unit: { select: { id: true, name: true, timezone: true } } } } },
  });
  for (const x of externals) {
    const u = units.get(x.account.unit.id) ?? { unitId: x.account.unit.id, name: x.account.unit.name, published: 0, failed: 0, ...zero() };
    const p = platforms.get(x.account.platform) ?? { platform: x.account.platform, published: 0, failed: 0, ...zero() };
    totals.imported++; u.published++; p.published++;
    seriesItems.push({ at: x.publishedAt, ok: true, timeZone: x.account.unit.timezone });
    const m = { likes: x.likes, comments: x.comments, shares: x.shares, reach: x.reach, impressions: x.impressions, saves: x.saves, clicks: x.clicks };
    add(engagement, m); add(u, m); add(p, m);
    coverage.withMetrics++;
    if (x.partial && x.account.platform !== "GOOGLE_BUSINESS_PROFILE") coverage.partial++;
    if (x.metricsFetchedAt && (!coverage.lastFetchedAt || x.metricsFetchedAt > coverage.lastFetchedAt)) coverage.lastFetchedAt = x.metricsFetchedAt;
    top.push({ targetId: x.id, postId: null, source: "external", caption: x.caption, unit: x.account.unit.name, platform: x.account.platform, externalUrl: x.permalink, publishedAt: x.publishedAt, score: engagementScore(m), ...m });
    units.set(u.unitId, u);
    platforms.set(p.platform, p);
  }
  totals.successRate = successRate(totals.published + totals.imported, totals.failed);

  return {
    range: { from, to, days: f.days },
    totals,
    engagement,
    metricsCoverage: coverage,
    series: dailySeries(seriesItems, from, to, timeZone),
    byUnit: [...units.values()].sort((a, b) => b.published - a.published || b.likes - a.likes),
    byPlatform: [...platforms.values()].sort((a, b) => b.published - a.published),
    topPosts: top.sort((a, b) => b.score - a.score).slice(0, 10),
    failures: [...failures.entries()].map(([code, count]) => ({ code, label: ERROR_LABELS[code] ?? code, count })).sort((a, b) => b.count - a.count),
    profile: await getProfileAnalytics(prisma, organizationId, allowed, f, from),
  };
}

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
  totals: { published: number; failed: number; scheduled: number; cancelled: number; successRate: number };
  engagement: Engagement;
  metricsCoverage: { withMetrics: number; partial: number; lastFetchedAt: Date | null };
  series: DayPoint[];
  byUnit: Array<{ unitId: string; name: string; published: number; failed: number } & Engagement>;
  byPlatform: Array<{ platform: string; published: number; failed: number } & Engagement>;
  topPosts: Array<{ targetId: string; postId: string; caption: string; unit: string; platform: string; externalUrl: string | null; publishedAt: Date | null; score: number } & Engagement>;
  failures: Array<{ code: string; label: string; count: number }>;
}

const zero = (): Engagement => ({ likes: 0, comments: 0, shares: 0, reach: 0, impressions: 0, saves: 0, clicks: 0 });
const add = (a: Engagement, m: Engagement) => { for (const k of Object.keys(a) as Array<keyof Engagement>) a[k] += m[k]; };

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

  const totals = { published: 0, failed: 0, scheduled: 0, cancelled: 0, successRate: 0 };
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
        if (t.metrics.partial) coverage.partial++;
        if (!coverage.lastFetchedAt || t.metrics.fetchedAt > coverage.lastFetchedAt) coverage.lastFetchedAt = t.metrics.fetchedAt;
        const m = { likes: t.metrics.likes, comments: t.metrics.comments, shares: t.metrics.shares, reach: t.metrics.reach, impressions: t.metrics.impressions, saves: t.metrics.saves, clicks: t.metrics.clicks };
        add(engagement, m); add(u, m); add(p, m);
        top.push({ targetId: t.id, postId: t.post.id, caption: t.post.caption, unit: t.account.unit.name, platform: t.account.platform, externalUrl: t.externalUrl, publishedAt: t.publishedAt, score: engagementScore(m), ...m });
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
  totals.successRate = successRate(totals.published, totals.failed);

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
  };
}

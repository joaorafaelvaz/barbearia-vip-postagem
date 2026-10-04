import Link from "next/link";
import { FailuresTable, RankingTables, TopPostsTable } from "@/components/AnalyticsTables";
import { DailyBarChart } from "@/components/BarChart";
import { IconAlert, IconCheck, IconClock, IconInfo } from "@/components/Icons";
import { AnalyticsActions } from "@/components/AnalyticsActions";
import { formatCompact } from "@/lib/analytics-utils";
import { allowedUnitIds } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { formatInTz } from "@/lib/format";
import { getAnalytics } from "@/lib/services/analytics";
import { requireSession } from "@/lib/session";

interface Search { dias?: string; unidade?: string; plataforma?: string }
const PERIODS = [7, 30, 90] as const;

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const days = (PERIODS.find((p) => String(p) === sp.dias) ?? 30) as 7 | 30 | 90;
  const allowed = await allowedUnitIds(prisma, s);
  const units = await prisma.unit.findMany({
    where: { organizationId: s.organizationId, ...(allowed ? { id: { in: allowed } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true, timezone: true },
  });
  const tz = units[0]?.timezone ?? "America/Sao_Paulo";
  const data = await getAnalytics(prisma, s.organizationId, allowed, { days, ...(sp.unidade ? { unitId: sp.unidade } : {}), ...(sp.plataforma ? { platform: sp.plataforma } : {}) }, tz);
  const q = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...over })) if (v) p.set(k, v);
    return `/analytics?${p}`;
  };
  const e = data.engagement;
  const cov = data.metricsCoverage;
  const cards: Array<[string, number]> = [["Curtidas", e.likes], ["Comentários", e.comments], ["Compartilhamentos", e.shares], ["Salvamentos", e.saves], ["Alcance", e.reach], ["Impressões", e.impressions], ["Cliques", e.clicks]];

  return (
    <div className="stack lg">
      <div className="page-head">
        <div><h1>Analytics</h1><p className="lead">Desempenho das publicações e engajamento nas plataformas, por unidade.</p></div>
        <AnalyticsActions />
      </div>

      <div className="toolbar">
        <div className="row" role="group" aria-label="Período">
          {PERIODS.map((p) => <Link key={p} className={`chip ${days === p ? "on" : ""}`} href={q({ dias: String(p) })}>{p} dias</Link>)}
        </div>
        <form className="filters" method="get">
          <input type="hidden" name="dias" value={days} />
          <label className="visually-hidden" htmlFor="a-unidade">Unidade</label>
          <select id="a-unidade" name="unidade" defaultValue={sp.unidade ?? ""}>
            <option value="">Todas as unidades</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <label className="visually-hidden" htmlFor="a-plat">Plataforma</label>
          <select id="a-plat" name="plataforma" defaultValue={sp.plataforma ?? ""}>
            <option value="">Todas as plataformas</option>
            <option value="INSTAGRAM">Instagram</option>
            <option value="FACEBOOK_PAGE">Facebook</option>
            <option value="GOOGLE_BUSINESS_PROFILE">Google Meu Negócio</option>
          </select>
          <button className="btn small" type="submit">Filtrar</button>
        </form>
      </div>

      <div className="kpis" aria-label="Publicações no período">
        <div className="kpi ok"><span className="label"><IconCheck size="sm" /> Publicadas</span><span className="value">{data.totals.published + data.totals.imported}</span><small>{data.totals.published} pelo sistema · {data.totals.imported} importadas</small></div>
        <div className="kpi err"><span className="label"><IconAlert size="sm" /> Falhas</span><span className="value">{data.totals.failed}</span></div>
        <div className="kpi info"><span className="label"><IconClock size="sm" /> Taxa de sucesso</span><span className="value">{data.totals.successRate}%</span></div>
      </div>

      <section className="card stack">
        <div className="row between"><h2 style={{ margin: 0 }}>Publicações por dia</h2><small>{data.totals.scheduled} ainda agendadas no período</small></div>
        <DailyBarChart series={data.series} title={`Publicações por dia nos últimos ${days} dias`} />
      </section>

      <section className="stack">
        <div className="row between">
          <h2 style={{ margin: 0 }}>Engajamento</h2>
          <small>{cov.lastFetchedAt ? `Atualizado ${formatInTz(cov.lastFetchedAt, tz)} · ${cov.withMetrics} de ${data.totals.published + data.totals.imported} publicações com métricas` : "Ainda sem métricas coletadas"}</small>
        </div>
        <div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          {cards.map(([label, v]) => <div className="kpi" key={label}><span className="label">{label}</span><span className="value">{formatCompact(v)}</span></div>)}
        </div>
        {cov.partial > 0 && (
          <div className="alert info"><IconInfo size="sm" /><span>{cov.partial} publicação(ões) com métricas parciais: alcance e impressões exigem as permissões de insights. Reconecte as contas em Unidades e contas para liberar.</span></div>
        )}
      </section>

      <RankingTables data={data} />
      <TopPostsTable data={data} tz={tz} />
      <FailuresTable data={data} />
    </div>
  );
}

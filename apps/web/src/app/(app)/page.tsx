import { POST_FORMAT_LABELS, utcToLocal, type PostFormat } from "@fsp/core";
import Link from "next/link";
import { PlatformBadge, StatusBadge } from "@/components/Badges";
import { BulkActions } from "@/components/BulkActions";
import { DashboardCalendar } from "@/components/DashboardCalendar";
import { IconAlert, IconCalendar, IconCheck, IconChevronLeft, IconChevronRight, IconClock, IconPlus } from "@/components/Icons";
import { TargetActions } from "@/components/TargetActions";
import { monthRange, shiftMonth } from "@/lib/dashboard";
import { allowedUnitIds } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { STATUS_LABELS, formatInTz, shorten } from "@/lib/format";
import { requireSession } from "@/lib/session";

interface Search { mes?: string; unidade?: string; plataforma?: string; status?: string; de?: string; ate?: string; ordem?: string; ok?: string }
const DAY_MS = 86_400_000;
const isDay = (v: string | undefined): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));
const fmtDay = (d: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const s = await requireSession();
  const sp = await searchParams;
  // Intervalo de datas (dia local de cada unidade). Quando informado, a lista ignora o mês e o calendário acompanha "de".
  const de = isDay(sp.de) ? sp.de : undefined;
  const ate = isDay(sp.ate) ? sp.ate : undefined;
  const byDate = Boolean(de || ate);
  const range = monthRange(sp.mes ?? de?.slice(0, 7));
  const newestFirst = sp.ordem !== "antigas";
  const windowStart = byDate ? (de ? new Date(`${de}T00:00:00Z`) : new Date(0)) : range.start;
  const windowEnd = byDate ? (ate ? new Date(new Date(`${ate}T00:00:00Z`).getTime() + DAY_MS) : new Date(Date.UTC(2100, 0, 1))) : range.end;
  const allowed = await allowedUnitIds(prisma, s);
  const accountFilter = {
    ...(sp.unidade ? { unitId: sp.unidade } : allowed ? { unitId: { in: allowed } } : {}),
    ...(sp.plataforma ? { platform: sp.plataforma as never } : {}),
  };
  const [units, allTargets] = await Promise.all([
    prisma.unit.findMany({ where: { organizationId: s.organizationId, ...(allowed ? { id: { in: allowed } } : {}) }, orderBy: { name: "asc" } }),
    prisma.postTarget.findMany({
      where: {
        organizationId: s.organizationId,
        scheduledAt: { gte: new Date(windowStart.getTime() - DAY_MS), lt: new Date(windowEnd.getTime() + DAY_MS) },
        ...(Object.keys(accountFilter).length ? { account: accountFilter } : {}),
        ...(sp.status ? { status: sp.status as never } : {}),
      },
      orderBy: { scheduledAt: newestFirst ? "desc" : "asc" },
      include: { post: true, account: { include: { unit: true } } },
    }),
  ]);
  // Corte exato pelo dia local da unidade (a consulta usa uma folga de 1 dia em UTC).
  const targets = byDate
    ? allTargets.filter((t) => {
        const day = utcToLocal(t.scheduledAt, t.account.unit.timezone).slice(0, 10);
        return (!de || day >= de) && (!ate || day <= ate);
      })
    : allTargets;
  const counts: Record<string, number> = {};
  for (const t of targets) counts[t.status] = (counts[t.status] ?? 0) + 1;
  const q = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ok: undefined, ...over })) if (v) p.set(k, v);
    return `/?${p.toString()}`;
  };
  const filtered = Boolean(sp.unidade || sp.plataforma || sp.status || byDate || sp.ordem);
  const periodLabel = byDate
    ? de && ate ? `de ${fmtDay(de)} a ${fmtDay(ate)}` : de ? `a partir de ${fmtDay(de)}` : `até ${fmtDay(ate as string)}`
    : `de ${range.label}`;
  const hasUnits = units.length > 0;

  return (
    <div className="stack lg">
      <div className="page-head">
        <div><h1>Painel</h1><p className="lead">Acompanhe o que está agendado e publicado em todas as unidades.</p></div>
        <Link className="btn primary" href="/novo"><IconPlus size="sm" /> Nova postagem</Link>
      </div>
      {sp.ok && <div className="alert ok" role="status"><IconCheck size="sm" /><span>Postagem agendada em todas as contas selecionadas.</span></div>}

      <div className="kpis" aria-label="Resumo do mês">
        <div className="kpi info"><span className="label"><IconClock size="sm" /> Agendadas</span><span className="value">{counts.SCHEDULED ?? 0}</span></div>
        <div className="kpi ok"><span className="label"><IconCheck size="sm" /> Publicadas</span><span className="value">{counts.PUBLISHED ?? 0}</span></div>
        <div className="kpi err"><span className="label"><IconAlert size="sm" /> Com falha</span><span className="value">{counts.FAILED ?? 0}</span></div>
      </div>

      <div className="toolbar">
        <div className="month">
          <Link className="btn small icon-only" href={q({ mes: shiftMonth(range.key, -1) })} aria-label="Mês anterior"><IconChevronLeft size="sm" /></Link>
          <strong>{range.label}</strong>
          <Link className="btn small icon-only" href={q({ mes: shiftMonth(range.key, 1) })} aria-label="Próximo mês"><IconChevronRight size="sm" /></Link>
        </div>
        <form className="filters" method="get">
          <input type="hidden" name="mes" value={range.key} />
          <label className="visually-hidden" htmlFor="f-unidade">Unidade</label>
          <select id="f-unidade" name="unidade" defaultValue={sp.unidade ?? ""}>
            <option value="">Todas as unidades</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <label className="visually-hidden" htmlFor="f-plat">Plataforma</label>
          <select id="f-plat" name="plataforma" defaultValue={sp.plataforma ?? ""}>
            <option value="">Todas as plataformas</option>
            <option value="INSTAGRAM">Instagram</option>
            <option value="FACEBOOK_PAGE">Facebook</option>
            <option value="GOOGLE_BUSINESS_PROFILE">Google Meu Negócio</option>
            <option value="TIKTOK">TikTok</option>
            <option value="YOUTUBE">YouTube</option>
          </select>
          <label className="visually-hidden" htmlFor="f-status">Status</label>
          <select id="f-status" name="status" defaultValue={sp.status ?? ""}>
            <option value="">Todos os status</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="visually-hidden" htmlFor="f-de">De</label>
          <input id="f-de" type="date" name="de" defaultValue={de ?? ""} aria-label="Data inicial" title="Data inicial (dia local da unidade)" />
          <label className="visually-hidden" htmlFor="f-ate">Até</label>
          <input id="f-ate" type="date" name="ate" defaultValue={ate ?? ""} aria-label="Data final" title="Data final (dia local da unidade)" />
          <label className="visually-hidden" htmlFor="f-ordem">Ordem</label>
          <select id="f-ordem" name="ordem" defaultValue={sp.ordem ?? ""}>
            <option value="">Mais recentes primeiro</option>
            <option value="antigas">Mais antigas primeiro</option>
          </select>
          <button className="btn small" type="submit">Filtrar</button>
          {filtered && <Link className="btn small ghost" href={q({ unidade: "", plataforma: "", status: "", de: "", ate: "", ordem: "" })}>Limpar</Link>}
        </form>
      </div>

      <DashboardCalendar
        range={range}
        todayKey={new Date().toISOString().slice(0, 10)}
        items={targets.map((t) => ({ id: t.id, postId: t.postId, status: t.status, scheduledAt: t.scheduledAt, unitName: t.account.unit.name, timezone: t.account.unit.timezone }))}
      />

      <section>
        <div className="row between">
          <h2>Publicações {periodLabel} <small className="muted" style={{ fontWeight: 400 }}>({targets.length})</small></h2>
          <BulkActions compact scope={{ from: windowStart.toISOString(), to: windowEnd.toISOString() }} retryable={(counts.FAILED ?? 0) + (counts.CANCELLED ?? 0)} cancellable={counts.SCHEDULED ?? 0} />
        </div>
        <div className="card tight">
          {targets.length === 0 ? (
            <div className="empty">
              <IconCalendar />
              <strong>{hasUnits ? (filtered ? "Nenhuma publicação com esses filtros" : "Nenhuma publicação neste período") : "Comece cadastrando suas unidades"}</strong>
              <span>{hasUnits ? "Agende uma postagem para vê-la aqui, com o status de cada conta." : "Depois conecte as contas de cada unidade e agende a primeira postagem."}</span>
              <Link className="btn primary" href={hasUnits ? "/novo" : "/unidades"}>{hasUnits ? "Nova postagem" : "Cadastrar unidades"}</Link>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Horário local</th><th scope="col">Unidade</th><th scope="col">Plataforma</th><th scope="col">Formato</th><th scope="col">Texto</th><th scope="col">Status</th><th scope="col"><span className="visually-hidden">Ações</span></th></tr></thead>
                <tbody>
                  {targets.map((t) => (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{formatInTz(t.scheduledAt, t.account.unit.timezone)}</td>
                      <td>{t.account.unit.name}</td>
                      <td><PlatformBadge platform={t.account.platform} /></td>
                      <td><span className="badge platform">{POST_FORMAT_LABELS[t.post.format as PostFormat]}</span></td>
                      <td><Link href={`/posts/${t.postId}`}>{shorten(t.post.caption || "(sem texto)")}</Link></td>
                      <td><StatusBadge status={t.status} />{t.lastError && <small style={{ display: "block", color: "var(--err)", marginTop: 4 }}>{shorten(t.lastError, 80)}</small>}</td>
                      <td className="actions"><TargetActions id={t.id} status={t.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

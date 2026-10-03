import { utcToLocal } from "@fsp/core";
import Link from "next/link";
import { TargetActions } from "@/components/TargetActions";
import { calendarCells, monthRange, shiftMonth } from "@/lib/dashboard";
import { prisma } from "@/lib/db";
import { STATUS_LABELS, formatInTz, platformLabel, shorten } from "@/lib/format";
import { requireSession } from "@/lib/session";

interface Search { mes?: string; unidade?: string; plataforma?: string; status?: string; ok?: string }

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const range = monthRange(sp.mes);

  const accountFilter = {
    ...(sp.unidade ? { unitId: sp.unidade } : {}),
    ...(sp.plataforma ? { platform: sp.plataforma as never } : {}),
  };

  const [units, targets] = await Promise.all([
    prisma.unit.findMany({ where: { organizationId: s.organizationId }, orderBy: { name: "asc" } }),
    prisma.postTarget.findMany({
      where: {
        organizationId: s.organizationId,
        scheduledAt: { gte: new Date(range.start.getTime() - DAY_MS), lt: new Date(range.end.getTime() + DAY_MS) },
        ...(Object.keys(accountFilter).length ? { account: accountFilter } : {}),
        ...(sp.status ? { status: sp.status as never } : {}),
      },
      orderBy: { scheduledAt: "asc" },
      include: { post: true, account: { include: { unit: true } } },
    }),
  ]);

  const byDay = new Map<string, typeof targets>();
  for (const t of targets) {
    const day = utcToLocal(t.scheduledAt, t.account.unit.timezone).slice(0, 10);
    if (!day.startsWith(range.key)) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), t]);
  }
  const counts: Record<string, number> = {};
  for (const t of targets) counts[t.status] = (counts[t.status] ?? 0) + 1;

  const q = (over: Partial<Search>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ok: undefined, ...over })) if (v) p.set(k, v);
    return `/?${p.toString()}`;
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Painel</h1>
        <Link className="btn primary" href="/novo">+ Nova postagem</Link>
      </div>
      {sp.ok && <div className="alert ok">Postagem agendada em todas as contas selecionadas.</div>}

      <div className="row">
        <Link className="btn small" href={q({ mes: shiftMonth(range.key, -1) })}>‹</Link>
        <strong style={{ textTransform: "capitalize" }}>{range.label}</strong>
        <Link className="btn small" href={q({ mes: shiftMonth(range.key, 1) })}>›</Link>
        <span className="muted" style={{ marginLeft: 12 }}>
          {counts.SCHEDULED ?? 0} agendadas · {counts.PUBLISHED ?? 0} publicadas · {counts.FAILED ?? 0} com falha
        </span>
      </div>

      <form className="row" method="get">
        <input type="hidden" name="mes" value={range.key} />
        <select name="unidade" defaultValue={sp.unidade ?? ""}>
          <option value="">Todas as unidades</option>
          {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select name="plataforma" defaultValue={sp.plataforma ?? ""}>
          <option value="">Todas as plataformas</option>
          <option value="INSTAGRAM">Instagram</option>
          <option value="FACEBOOK_PAGE">Facebook</option>
          <option value="GOOGLE_BUSINESS_PROFILE">Google Meu Negócio</option>
        </select>
        <select name="status" defaultValue={sp.status ?? ""}>
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn small" type="submit">Filtrar</button>
      </form>

      <div className="calendar">
        {WEEKDAYS.map((d) => <div key={d} className="muted" style={{ fontSize: 12, textAlign: "center" }}>{d}</div>)}
        {calendarCells(range).map((day, i) => {
          const items = day ? byDay.get(day) ?? [] : [];
          return (
            <div key={i} className={`day ${day ? "" : "other"}`}>
              {day && <span className="n">{Number(day.slice(-2))}</span>}
              {items.slice(0, 4).map((t) => (
                <Link key={t.id} className={`dot ${t.status}`} href={`/posts/${t.postId}`} title={t.post.caption}>
                  {utcToLocal(t.scheduledAt, t.account.unit.timezone).slice(11)} {t.account.unit.name}
                </Link>
              ))}
              {items.length > 4 && <small>+{items.length - 4}</small>}
            </div>
          );
        })}
      </div>

      <h2>Publicações do mês</h2>
      <div className="card">
        {targets.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nenhuma publicação neste período.</p> : (
          <table>
            <thead><tr><th>Horário local</th><th>Unidade</th><th>Plataforma</th><th>Texto</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id}>
                  <td>{formatInTz(t.scheduledAt, t.account.unit.timezone)}</td>
                  <td>{t.account.unit.name}</td>
                  <td><span className="badge platform">{platformLabel(t.account.platform)}</span></td>
                  <td><Link href={`/posts/${t.postId}`}>{shorten(t.post.caption || "(sem texto)")}</Link></td>
                  <td>
                    <span className={`badge ${t.status}`}>{STATUS_LABELS[t.status]}</span>
                    {t.lastError && <small style={{ display: "block", color: "var(--err)" }}>{shorten(t.lastError, 80)}</small>}
                  </td>
                  <td><TargetActions id={t.id} status={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

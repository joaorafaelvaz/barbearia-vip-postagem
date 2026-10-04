import Link from "next/link";
import type { AnalyticsData } from "@/lib/services/analytics";
import { formatCompact } from "@/lib/analytics-utils";
import { formatInTz, shorten } from "@/lib/format";
import { PlatformBadge } from "./Badges";
import { IconChart } from "./Icons";

const n = (v: number) => formatCompact(v);

export function RankingTables({ data }: { data: AnalyticsData }) {
  const head = <thead><tr><th scope="col">Publ.</th><th scope="col">Falhas</th><th scope="col">Curtidas</th><th scope="col">Coment.</th><th scope="col">Alcance</th></tr></thead>;
  return (
    <div className="grid cols-2">
      <section className="card tight stack">
        <h2 style={{ margin: 0 }}>Por unidade</h2>
        <div className="table-wrap"><table>
          <thead><tr><th scope="col">Unidade</th>{head.props.children.props.children}</tr></thead>
          <tbody>
            {data.byUnit.length === 0 && <tr><td colSpan={6} className="muted">Sem dados no período.</td></tr>}
            {data.byUnit.map((u) => <tr key={u.unitId}><td>{u.name}</td><td>{u.published}</td><td>{u.failed}</td><td>{n(u.likes)}</td><td>{n(u.comments)}</td><td>{n(u.reach)}</td></tr>)}
          </tbody>
        </table></div>
      </section>
      <section className="card tight stack">
        <h2 style={{ margin: 0 }}>Por plataforma</h2>
        <div className="table-wrap"><table>
          <thead><tr><th scope="col">Plataforma</th>{head.props.children.props.children}</tr></thead>
          <tbody>
            {data.byPlatform.length === 0 && <tr><td colSpan={6} className="muted">Sem dados no período.</td></tr>}
            {data.byPlatform.map((p) => <tr key={p.platform}><td><PlatformBadge platform={p.platform} /></td><td>{p.published}</td><td>{p.failed}</td><td>{n(p.likes)}</td><td>{n(p.comments)}</td><td>{n(p.reach)}</td></tr>)}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}

export function TopPostsTable({ data, tz }: { data: AnalyticsData; tz: string }) {
  return (
    <section className="card tight stack">
      <h2 style={{ margin: 0 }}>Publicações com mais engajamento</h2>
      {data.topPosts.length === 0 ? (
        <div className="empty"><IconChart /><strong>Ainda sem métricas</strong><span>As métricas são coletadas a cada 6 horas para publicações dos últimos 30 dias. Use "Atualizar métricas" para buscar agora.</span></div>
      ) : (
        <div className="table-wrap"><table>
          <thead><tr><th scope="col">Publicação</th><th scope="col">Unidade</th><th scope="col">Plataforma</th><th scope="col">Curtidas</th><th scope="col">Coment.</th><th scope="col">Compart.</th><th scope="col">Alcance</th><th scope="col"><span className="visually-hidden">Link</span></th></tr></thead>
          <tbody>
            {data.topPosts.map((t) => (
              <tr key={t.targetId}>
                <td>
                  {t.postId ? <Link href={`/posts/${t.postId}`}>{shorten(t.caption || "(sem texto)", 50)}</Link> : <span>{shorten(t.caption || "(sem texto)", 50)}</span>}
                  {t.source === "external" && <span className="badge platform" style={{ marginLeft: 6 }}>importada</span>}
                  <br /><small>{t.publishedAt ? formatInTz(t.publishedAt, tz) : ""}</small>
                </td>
                <td>{t.unit}</td><td><PlatformBadge platform={t.platform} /></td>
                <td>{n(t.likes)}</td><td>{n(t.comments)}</td><td>{n(t.shares)}</td><td>{n(t.reach)}</td>
                <td>{t.externalUrl && <a href={t.externalUrl} target="_blank" rel="noreferrer">Ver</a>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </section>
  );
}

export function FailuresTable({ data }: { data: AnalyticsData }) {
  if (data.failures.length === 0) return null;
  return (
    <section className="card tight stack">
      <h2 style={{ margin: 0 }}>Motivos das falhas</h2>
      <div className="table-wrap"><table>
        <thead><tr><th scope="col">Motivo</th><th scope="col">Ocorrências</th></tr></thead>
        <tbody>{data.failures.map((f) => <tr key={f.code}><td>{f.label} <small>({f.code})</small></td><td>{f.count}</td></tr>)}</tbody>
      </table></div>
      <small>Abra a publicação no painel para ver o erro completo e re-tentar.</small>
    </section>
  );
}

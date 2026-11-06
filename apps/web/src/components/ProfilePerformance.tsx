import Link from "next/link";
import type { AnalyticsData } from "@/lib/services/analytics";
import { formatCompact } from "@/lib/analytics-utils";
import { formatInTz } from "@/lib/format";
import { IconAlert, IconChart, IconInfo } from "./Icons";

const n = (v: number) => formatCompact(v);

/** Desempenho do perfil no Google Meu Negócio (o Google não fornece métricas por postagem). */
export function ProfilePerformance({ data, tz }: { data: AnalyticsData; tz: string }) {
  const p = data.profile;
  if (!p || p.accounts === 0) return null;
  const t = p.totals;
  const cards: Array<[string, number]> = [
    ["Impressões na Busca", t.impressionsSearch],
    ["Impressões no Maps", t.impressionsMaps],
    ["Cliques no site", t.websiteClicks],
    ["Ligações", t.callClicks],
    ["Rotas", t.directionRequests],
    ["Mensagens", t.messagingClicks],
  ];
  const hasData = p.byUnit.some((u) => u.days > 0);
  const apiOff = p.errors.some((e) => /Performance API|has not been used|disabled|PERMISSION_DENIED/i.test(e.message));
  const tokenOff = p.errors.some((e) => /INVALID_TOKEN/.test(e.message));
  return (
    <section className="stack" aria-label="Perfil no Google Meu Negócio">
      <div className="row between">
        <h2 style={{ margin: 0 }}>Perfil no Google Meu Negócio</h2>
        <small>{p.lastFetchedAt ? `Atualizado ${formatInTz(p.lastFetchedAt, tz)}${p.lastDay ? ` · dados até ${p.lastDay}` : ""}` : "Ainda sem coleta"}</small>
      </div>
      {p.errors.length > 0 && (
        <div className="alert warn" role="alert">
          <IconAlert size="sm" />
          <span>
            {p.errors.length === p.accounts ? "Nenhum perfil" : `${p.errors.length} de ${p.accounts} perfis`} do Google respondeu na última coleta.
            {apiOff && " Habilite a Business Profile Performance API no projeto do Google Cloud do app e clique em \"Atualizar métricas\"."}
            {tokenOff && <> Há conta com token inválido: reconecte em <Link href="/unidades">Unidades e contas</Link>.</>}
            <details><summary>Detalhes</summary><ul>{p.errors.map((e) => <li key={e.accountId}><strong>{e.unit}</strong> ({e.account}): {e.message}</li>)}</ul></details>
          </span>
        </div>
      )}
      {!hasData && p.errors.length === 0 ? (
        <div className="empty"><IconChart /><strong>Ainda sem dados do perfil</strong><span>Os números do Google chegam com alguns dias de atraso. Use &quot;Atualizar métricas&quot; para buscar agora.</span></div>
      ) : (
        <>
          <div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            {cards.map(([label, v]) => <div className="kpi" key={label}><span className="label">{label}</span><span className="value">{n(v)}</span></div>)}
          </div>
          <section className="card tight stack">
            <div className="table-wrap"><table>
              <thead><tr><th scope="col">Unidade</th><th scope="col">Busca</th><th scope="col">Maps</th><th scope="col">Site</th><th scope="col">Ligações</th><th scope="col">Rotas</th><th scope="col">Mensagens</th></tr></thead>
              <tbody>
                {p.byUnit.map((u) => (
                  <tr key={u.accountId}>
                    <td>{u.unit}<br /><small>{u.account}</small></td>
                    <td>{n(u.impressionsSearch)}</td><td>{n(u.impressionsMaps)}</td><td>{n(u.websiteClicks)}</td><td>{n(u.callClicks)}</td><td>{n(u.directionRequests)}</td><td>{n(u.messagingClicks)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        </>
      )}
      <div className="alert info"><IconInfo size="sm" /><span>O Google não fornece métricas por postagem desde 2023: estes números são do perfil inteiro (Busca e Maps) no período, com atraso de alguns dias.</span></div>
    </section>
  );
}

import Link from "next/link";
import { PlatformBadge } from "@/components/Badges";
import { DisconnectButton } from "@/components/DisconnectButton";
import { IconAlert, IconCheck, IconFacebook, IconMapPin, IconStore } from "@/components/Icons";
import { UnitForm } from "@/components/UnitForm";
import { prisma } from "@/lib/db";
import { listUnitsWithAccounts } from "@/lib/services/accounts";
import { requireSession } from "@/lib/session";

const ERRORS: Record<string, string> = {
  meta_state: "A autorização da Meta não pôde ser validada. Tente novamente.",
  google_state: "A autorização do Google não pôde ser validada. Tente novamente.",
  google_refresh: "O Google não devolveu um refresh token. Remova o acesso do app na sua conta Google e autorize de novo.",
};

export default async function UnitsPage({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const units = await listUnitsWithAccounts(prisma, s.organizationId);
  const hasMeta = Boolean(process.env.META_APP_ID);
  const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID);

  return (
    <div className="stack lg">
      <div className="page-head">
        <div>
          <h1>Unidades e contas</h1>
          <p className="lead">Cada unidade tem suas próprias contas. Conecte o Facebook/Instagram e o Google Meu Negócio de cada uma.</p>
        </div>
      </div>
      {sp.erro && <div className="alert error" role="alert"><IconAlert size="sm" /><span>{ERRORS[sp.erro] ?? "Erro na conexão."}</span></div>}
      {sp.ok && <div className="alert ok" role="status"><IconCheck size="sm" /><span>Contas vinculadas com sucesso.</span></div>}
      {(!hasMeta || !hasGoogle) && (
        <div className="alert info"><IconAlert size="sm" /><span>
          {!hasMeta && "Conexão com Facebook/Instagram desabilitada: configure META_APP_ID e META_APP_SECRET. "}
          {!hasGoogle && "Conexão com Google Meu Negócio desabilitada: configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET."}
        </span></div>
      )}

      <UnitForm />

      {units.length === 0 ? (
        <div className="card"><div className="empty"><IconStore /><strong>Nenhuma unidade ainda</strong><span>Cadastre a primeira unidade no formulário acima.</span></div></div>
      ) : (
        <div className="grid cols-2">
          {units.map((u) => (
            <section className="card stack" key={u.id} aria-labelledby={`u-${u.id}`}>
              <div className="row between">
                <div>
                  <h3 id={`u-${u.id}`}>{u.name}</h3>
                  <small>{u.city ? `${u.city} · ` : ""}{u.timezone}</small>
                </div>
                <div className="row">
                  {hasMeta && <Link className="btn small" href={`/api/oauth/meta/start?unitId=${u.id}`}><IconFacebook size="sm" /> Facebook/Instagram</Link>}
                  {hasGoogle && <Link className="btn small" href={`/api/oauth/google/start?unitId=${u.id}`}><IconMapPin size="sm" /> Google</Link>}
                </div>
              </div>
              {u.accounts.length === 0 ? (
                <div className="alert warn"><IconAlert size="sm" /><span>Nenhuma conta conectada. Use os botões acima para vincular.</span></div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <tbody>
                      {u.accounts.map((a) => (
                        <tr key={a.id}>
                          <td style={{ width: 1 }}><PlatformBadge platform={a.platform} /></td>
                          <td>{a.displayName}</td>
                          <td className="actions"><DisconnectButton id={a.id} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

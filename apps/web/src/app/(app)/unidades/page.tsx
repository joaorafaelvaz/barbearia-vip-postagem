import Link from "next/link";
import { DisconnectButton } from "@/components/DisconnectButton";
import { UnitForm } from "@/components/UnitForm";
import { prisma } from "@/lib/db";
import { platformLabel } from "@/lib/format";
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
    <div className="stack">
      <h1>Unidades e contas</h1>
      {sp.erro && <div className="alert error">{ERRORS[sp.erro] ?? "Erro na conexão."}</div>}
      {sp.ok && <div className="alert ok">Contas vinculadas com sucesso.</div>}
      {!hasMeta && <div className="alert warn">META_APP_ID não configurado: a conexão com Facebook/Instagram está desabilitada.</div>}
      {!hasGoogle && <div className="alert warn">GOOGLE_CLIENT_ID não configurado: a conexão com Google Meu Negócio está desabilitada.</div>}

      <UnitForm />

      {units.length === 0 && <p className="muted">Nenhuma unidade ainda. Cadastre a primeira acima.</p>}

      <div className="grid cols-2">
        {units.map((u) => (
          <div className="card stack" key={u.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <strong>{u.name}</strong>
                <br />
                <small>{u.city ? `${u.city} · ` : ""}{u.timezone}</small>
              </div>
              <div className="row">
                {hasMeta && <Link className="btn small" href={`/api/oauth/meta/start?unitId=${u.id}`}>+ Facebook/Instagram</Link>}
                {hasGoogle && <Link className="btn small" href={`/api/oauth/google/start?unitId=${u.id}`}>+ Google</Link>}
              </div>
            </div>
            {u.accounts.length === 0 ? (
              <small>Nenhuma conta conectada.</small>
            ) : (
              <table>
                <tbody>
                  {u.accounts.map((a) => (
                    <tr key={a.id}>
                      <td><span className="badge platform">{platformLabel(a.platform)}</span></td>
                      <td>{a.displayName}</td>
                      <td style={{ textAlign: "right" }}><DisconnectButton id={a.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

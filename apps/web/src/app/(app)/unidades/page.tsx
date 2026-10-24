import Link from "next/link";
import { PlatformBadge } from "@/components/Badges";
import { ChatIdField } from "@/components/ChatIdField";
import { DeleteUnitButton } from "@/components/DeleteUnitButton";
import { DisconnectButton } from "@/components/DisconnectButton";
import { IconAlert, IconCheck, IconFacebook, IconMapPin, IconStore, IconTikTok, IconYouTube } from "@/components/Icons";
import { UnitForm } from "@/components/UnitForm";
import { allowedUnitIds, isAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { listUnitsWithAccounts } from "@/lib/services/accounts";
import { requireSession } from "@/lib/session";

const ERRORS: Record<string, string> = {
  meta_state: "A autorização da Meta não pôde ser validada. Tente novamente.",
  google_state: "A autorização do Google não pôde ser validada. Tente novamente.",
  google_refresh: "O Google não devolveu um refresh token. Remova o acesso do app na sua conta Google e autorize de novo.",
  tiktok_state: "A autorização do TikTok não pôde ser validada. Tente novamente.",
  youtube_state: "A autorização do YouTube não pôde ser validada. Tente novamente.",
  youtube_refresh: "O Google não devolveu um refresh token para o YouTube. Remova o acesso do app na sua conta Google e autorize de novo.",
  youtube_nochannel: "A conta Google autorizada não tem canal no YouTube.",
};

export default async function UnitsPage({ searchParams }: { searchParams: Promise<{ erro?: string; ok?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const admin = isAdmin(s);
  const units = await listUnitsWithAccounts(prisma, s.organizationId, await allowedUnitIds(prisma, s));
  const org = admin ? await prisma.organization.findUniqueOrThrow({ where: { id: s.organizationId }, select: { whatsappChatId: true } }) : null;
  const hasMeta = Boolean(process.env.META_APP_ID);
  const hasGoogle = Boolean(process.env.GOOGLE_CLIENT_ID);
  const hasTikTok = Boolean(process.env.TIKTOK_CLIENT_KEY);

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

      {admin ? <UnitForm /> : <div className="alert info"><IconAlert size="sm" /><span>Você vê as unidades delegadas a você. Só o administrador cadastra unidades.</span></div>}
      {admin && org && (
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Grupo WhatsApp da franqueadora</h2>
          <p className="muted">Destino "Franqueadora" dos Avisos WhatsApp. Formato WAHA: id do grupo (<code>...@g.us</code>) ou número (<code>55DDDN@c.us</code>).</p>
          <ChatIdField endpoint="/api/organization" value={org.whatsappChatId} label="Grupo da franqueadora" id="org-chat" />
        </section>
      )}

      {units.length === 0 ? (
        <div className="card"><div className="empty"><IconStore /><strong>{admin ? "Nenhuma unidade ainda" : "Nenhuma unidade delegada a você"}</strong><span>{admin ? "Cadastre a primeira unidade no formulário acima." : "Peça ao administrador para delegar unidades ao seu usuário."}</span></div></div>
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
                  {hasTikTok && <Link className="btn small" href={`/api/oauth/tiktok/start?unitId=${u.id}`}><IconTikTok size="sm" /> TikTok</Link>}
                  {hasGoogle && <Link className="btn small" href={`/api/oauth/youtube/start?unitId=${u.id}`}><IconYouTube size="sm" /> YouTube</Link>}
                  {admin && <DeleteUnitButton id={u.id} name={u.name} />}
                </div>
              </div>
              {admin && <ChatIdField endpoint={`/api/units/${u.id}`} value={u.whatsappChatId} label="Grupo WhatsApp da unidade (Avisos)" id={`chat-${u.id}`} hint={u.whatsappChatId ? undefined : "Sem grupo, a unidade não recebe avisos."} />}
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

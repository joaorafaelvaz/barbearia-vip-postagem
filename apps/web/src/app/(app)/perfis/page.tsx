import Link from "next/link";
import { PlatformBadge } from "@/components/Badges";
import { IconChevronRight, IconStore } from "@/components/Icons";
import { allowedUnitIds } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { listUnitsWithAccounts } from "@/lib/services/accounts";
import { PROFILE_SUPPORTED } from "@/lib/services/profiles";
import { requireSession } from "@/lib/session";

export default async function ProfilesPage() {
  const s = await requireSession();
  const units = await listUnitsWithAccounts(prisma, s.organizationId, await allowedUnitIds(prisma, s));
  const withAccounts = units.filter((u) => u.accounts.length > 0);

  return (
    <div className="stack lg">
      <div className="page-head">
        <div>
          <h1>Perfis</h1>
          <p className="lead">Veja o perfil de cada conta, acompanhe as publicações, responda comentários e exclua o que não deve ficar no ar. Instagram primeiro; Facebook e Google em breve.</p>
        </div>
      </div>
      {withAccounts.length === 0 ? (
        <div className="card"><div className="empty"><IconStore /><strong>Nenhuma conta conectada</strong><span>Conecte as contas das unidades em "Unidades e contas".</span></div></div>
      ) : (
        <div className="grid cols-2">
          {withAccounts.map((u) => (
            <section className="card stack" key={u.id} aria-labelledby={`pf-${u.id}`}>
              <div>
                <h3 id={`pf-${u.id}`}>{u.name}</h3>
                <small>{u.city ? `${u.city} · ` : ""}{u.timezone}</small>
              </div>
              <ul className="pf-accounts">
                {u.accounts.map((a) => {
                  const ok = PROFILE_SUPPORTED.has(a.platform);
                  const inner = (
                    <>
                      <PlatformBadge platform={a.platform} />
                      <span className="pf-name">{a.displayName}</span>
                      {ok ? <IconChevronRight size="sm" /> : <small className="muted">em breve</small>}
                    </>
                  );
                  return (
                    <li key={a.id}>
                      {ok ? <Link href={`/perfis/${a.id}`} className="pf-account">{inner}</Link> : <span className="pf-account disabled">{inner}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

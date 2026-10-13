import { PublishError } from "@fsp/core";
import type { IgMediaPage, IgProfile } from "@fsp/connectors";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconAlert, IconChevronLeft, IconLink } from "@/components/Icons";
import { ProfileMediaGrid } from "@/components/ProfileMediaGrid";
import { HttpError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { loadInstagramAccount } from "@/lib/services/profiles";
import { requireSession } from "@/lib/session";

const fmt = (n: number) => n.toLocaleString("pt-BR");

export default async function ProfilePage({ params }: { params: Promise<{ accountId: string }> }) {
  const s = await requireSession();
  const { accountId } = await params;
  let loaded: Awaited<ReturnType<typeof loadInstagramAccount>>;
  try {
    loaded = await loadInstagramAccount(prisma, s, accountId);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }
  const { account, token, client } = loaded;

  let profile: IgProfile | null = null;
  let media: IgMediaPage = { items: [] };
  let error: string | null = null;
  try {
    [profile, media] = await Promise.all([client.getProfile(account.externalId, token), client.listMedia(account.externalId, token)]);
  } catch (err) {
    const perr = err instanceof PublishError ? err : null;
    error = perr?.code === "PERMISSION_DENIED" || perr?.code === "INVALID_TOKEN"
      ? `O Instagram recusou o acesso (${perr.message}). Reconecte esta conta em "Unidades e contas" para conceder as permissões novas.`
      : `Não foi possível carregar o perfil: ${err instanceof Error ? err.message : String(err)}`;
  }

  return (
    <div className="stack lg">
      <div className="page-head">
        <div>
          <Link href="/perfis" className="row" style={{ gap: 4, marginBottom: 8 }}><IconChevronLeft size="sm" /> Perfis</Link>
          <h1>{account.displayName}</h1>
          <p className="lead">Instagram · {account.unit.name}</p>
        </div>
      </div>
      {error && <div className="alert error" role="alert"><IconAlert size="sm" /><span>{error}</span></div>}
      {profile && (
        <section className="card pf-header" aria-label="Perfil">
          {profile.profilePictureUrl ? <img className="pf-avatar" src={profile.profilePictureUrl} alt="" /> : <span className="pf-avatar placeholder">{profile.username.slice(0, 1).toUpperCase()}</span>}
          <div className="stack" style={{ gap: 6, minWidth: 0 }}>
            <div className="row" style={{ gap: 10 }}>
              <strong style={{ fontSize: "var(--fs-lg)" }}>@{profile.username}</strong>
              <a className="btn small" href={`https://www.instagram.com/${profile.username}/`} target="_blank" rel="noreferrer"><IconLink size="sm" /> Abrir no Instagram</a>
            </div>
            {profile.name && <span>{profile.name}</span>}
            <div className="pf-stats">
              <span><strong>{fmt(profile.mediaCount)}</strong> publicações</span>
              <span><strong>{fmt(profile.followersCount)}</strong> seguidores</span>
              <span><strong>{fmt(profile.followsCount)}</strong> seguindo</span>
            </div>
            {profile.biography && <p className="pf-bio">{profile.biography}</p>}
            {profile.website && <a href={profile.website} target="_blank" rel="noreferrer">{profile.website}</a>}
          </div>
        </section>
      )}
      {profile && (
        <section className="stack">
          <h2>Publicações</h2>
          <ProfileMediaGrid accountId={account.id} initial={media} />
        </section>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatformBadge, StatusBadge } from "@/components/Badges";
import { IconChevronLeft, IconLink } from "@/components/Icons";
import { TargetActions } from "@/components/TargetActions";
import { allowedUnitIds } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { POST_FORMAT_LABELS, type PostFormat } from "@fsp/core";
import { formatInTz, formatLocal } from "@/lib/format";
import { requireSession } from "@/lib/session";

export default async function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const allowed = await allowedUnitIds(prisma, s);
  const targetsWhere = allowed ? { account: { unitId: { in: allowed } } } : {};
  const post = await prisma.post.findFirst({
    where: { id, organizationId: s.organizationId, ...(allowed ? { targets: { some: targetsWhere } } : {}) },
    include: {
      media: { include: { media: true }, orderBy: { position: "asc" } },
      targets: { where: targetsWhere, include: { account: { include: { unit: true } } }, orderBy: { scheduledAt: "asc" } },
    },
  });
  if (!post) notFound();
  const counts: Record<string, number> = {};
  for (const t of post.targets) counts[t.status] = (counts[t.status] ?? 0) + 1;

  return (
    <div className="stack lg">
      <div className="page-head">
        <div>
          <Link href="/" className="row" style={{ gap: 4, marginBottom: 8 }}><IconChevronLeft size="sm" /> Painel</Link>
          <h1>Postagem de {formatLocal(post.scheduledLocal)} <span className="badge platform" style={{ verticalAlign: "middle" }}>{POST_FORMAT_LABELS[post.format as PostFormat]}</span></h1>
          <p className="lead">{post.targets.length} conta{post.targets.length === 1 ? "" : "s"} · {Object.entries(counts).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ")}</p>
        </div>
      </div>
      <div className="card stack">
        <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{post.caption || <span className="muted">(sem texto)</span>}</p>
        {post.media.length > 0 && (
          <div className="thumbs">
            {post.media.map((m, i) =>
              m.media.kind === "VIDEO" ? (
                <video key={m.mediaId} src={m.media.publicUrl} controls style={{ width: 240, maxHeight: 320, borderRadius: 8, border: "1px solid var(--border)" }} />
              ) : (
                <div className="thumb" key={m.mediaId}><img src={m.media.publicUrl} alt={`Mídia ${i + 1}`} /></div>
              ),
            )}
          </div>
        )}
      </div>
      <section>
        <h2>Publicações por conta</h2>
        <div className="card tight">
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th scope="col">Unidade</th><th scope="col">Plataforma</th><th scope="col">Conta</th><th scope="col">Horário local</th><th scope="col">Status</th><th scope="col">Detalhe</th><th scope="col"><span className="visually-hidden">Ações</span></th></tr>
              </thead>
              <tbody>
                {post.targets.map((t) => (
                  <tr key={t.id}>
                    <td>{t.account.unit.name}</td>
                    <td><PlatformBadge platform={t.account.platform} /></td>
                    <td>{t.account.displayName}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatInTz(t.scheduledAt, t.account.unit.timezone)}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td>
                      {t.externalUrl && <a href={t.externalUrl} target="_blank" rel="noreferrer" className="row" style={{ gap: 4 }}><IconLink size="sm" /> Ver publicação</a>}
                      {t.lastError && <small style={{ color: "var(--err)", display: "block" }}>{t.lastError}</small>}
                      {t.attempts > 0 && <small>{t.attempts} tentativa{t.attempts > 1 ? "s" : ""}</small>}
                    </td>
                    <td className="actions"><TargetActions id={t.id} status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { TargetActions } from "@/components/TargetActions";
import { prisma } from "@/lib/db";
import { STATUS_LABELS, formatInTz, formatLocal, platformLabel } from "@/lib/format";
import { requireSession } from "@/lib/session";

export default async function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const post = await prisma.post.findFirst({
    where: { id, organizationId: s.organizationId },
    include: {
      media: { include: { media: true }, orderBy: { position: "asc" } },
      targets: { include: { account: { include: { unit: true } } }, orderBy: { scheduledAt: "asc" } },
    },
  });
  if (!post) notFound();

  return (
    <div className="stack">
      <p><Link href="/">← Painel</Link></p>
      <h1>Postagem de {formatLocal(post.scheduledLocal)}</h1>
      <div className="card stack">
        <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{post.caption}</p>
        {post.media.length > 0 && (
          <div className="thumbs">
            {post.media.map((m) =>
              m.media.kind === "VIDEO" ? (
                <video key={m.mediaId} src={m.media.publicUrl} controls style={{ width: 240, maxHeight: 320, borderRadius: 8, border: "1px solid var(--border)" }} />
              ) : (
                <img key={m.mediaId} src={m.media.publicUrl} alt="" />
              ),
            )}
          </div>
        )}
      </div>
      <h2>Publicações por conta ({post.targets.length})</h2>
      <div className="card">
        <table>
          <thead>
            <tr><th>Unidade</th><th>Plataforma</th><th>Conta</th><th>Horário local</th><th>Status</th><th>Detalhe</th><th></th></tr>
          </thead>
          <tbody>
            {post.targets.map((t) => (
              <tr key={t.id}>
                <td>{t.account.unit.name}</td>
                <td><span className="badge platform">{platformLabel(t.account.platform)}</span></td>
                <td>{t.account.displayName}</td>
                <td>{formatInTz(t.scheduledAt, t.account.unit.timezone)}</td>
                <td><span className={`badge ${t.status}`}>{STATUS_LABELS[t.status]}</span></td>
                <td>
                  {t.externalUrl && <a href={t.externalUrl} target="_blank" rel="noreferrer">Ver publicação</a>}
                  {t.lastError && <small style={{ color: "var(--err)", display: "block" }}>{t.lastError}</small>}
                  {t.attempts > 0 && <small>{t.attempts} tentativa{t.attempts > 1 ? "s" : ""}</small>}
                </td>
                <td><TargetActions id={t.id} status={t.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

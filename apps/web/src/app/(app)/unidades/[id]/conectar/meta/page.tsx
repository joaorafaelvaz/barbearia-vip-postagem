import { listMetaPages } from "@fsp/connectors";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountPicker } from "@/components/AccountPicker";
import { getCipher } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { META_PENDING_COOKIE } from "@/lib/oauth-meta";
import { requireSession } from "@/lib/session";

export default async function ConnectMetaPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const unit = await prisma.unit.findFirst({ where: { id, organizationId: s.organizationId } });
  if (!unit) notFound();

  const pending = (await cookies()).get(META_PENDING_COOKIE)?.value;
  if (!pending) {
    return (
      <div className="stack">
        <h1>Conectar Facebook e Instagram — {unit.name}</h1>
        <div className="alert warn">A autorização expirou ou não foi concluída.</div>
        <div><Link className="btn primary" href={`/api/oauth/meta/start?unitId=${unit.id}`}>Autorizar novamente</Link></div>
      </div>
    );
  }

  let options: Array<{ id: string; title: string; subtitle?: string }> = [];
  let error: string | null = null;
  try {
    const pages = await listMetaPages(getCipher().decrypt(pending));
    options = pages.map((p) => {
      const ig = p.instagramBusinessAccount;
      const opt: { id: string; title: string; subtitle?: string } = { id: p.id, title: p.name };
      opt.subtitle = ig ? `Facebook Page + Instagram ${ig.username ? "@" + ig.username : ig.id}` : "Facebook Page (sem Instagram Business vinculado)";
      return opt;
    });
  } catch (e) {
    error = e instanceof Error ? e.message : "Erro ao listar Pages";
  }

  return (
    <div className="stack">
      <h1>Conectar Facebook e Instagram — {unit.name}</h1>
      <p className="muted">Escolha a Page desta unidade. O Instagram Business vinculado à Page é conectado junto.</p>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        <AccountPicker
          unitId={unit.id}
          options={options}
          endpoint="/api/oauth/meta/connect"
          field="pageIds"
          emptyMessage="Nenhuma Page encontrada. Verifique se você é administrador da Page e se concedeu as permissões."
        />
      </div>
    </div>
  );
}

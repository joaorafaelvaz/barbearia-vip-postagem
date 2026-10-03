import { listGoogleLocations } from "@fsp/connectors";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountPicker } from "@/components/AccountPicker";
import { getCipher } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { GOOGLE_PENDING_COOKIE, type GooglePending } from "@/lib/oauth-google";
import { requireSession } from "@/lib/session";

export default async function ConnectGooglePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const unit = await prisma.unit.findFirst({ where: { id, organizationId: s.organizationId } });
  if (!unit) notFound();

  const raw = (await cookies()).get(GOOGLE_PENDING_COOKIE)?.value;
  if (!raw) {
    return (
      <div className="stack">
        <h1>Conectar Google Meu Negócio — {unit.name}</h1>
        <div className="alert warn">A autorização expirou ou não foi concluída.</div>
        <div><Link className="btn primary" href={`/api/oauth/google/start?unitId=${unit.id}`}>Autorizar novamente</Link></div>
      </div>
    );
  }

  let options: Array<{ id: string; title: string; subtitle?: string }> = [];
  let error: string | null = null;
  try {
    const pending = JSON.parse(getCipher().decrypt(raw)) as GooglePending;
    const locations = await listGoogleLocations(pending.accessToken);
    options = locations.map((l) => (l.address ? { id: l.name, title: l.title, subtitle: l.address } : { id: l.name, title: l.title }));
  } catch (e) {
    error = e instanceof Error ? e.message : "Erro ao listar locations";
  }

  return (
    <div className="stack">
      <h1>Conectar Google Meu Negócio — {unit.name}</h1>
      <p className="muted">Escolha o perfil (location) desta unidade.</p>
      {error && (
        <div className="alert error">
          {error}. Se a mensagem indicar falta de acesso à API, o projeto Google ainda não foi aprovado para a Business Profile API.
        </div>
      )}
      <div className="card">
        <AccountPicker
          unitId={unit.id}
          options={options}
          endpoint="/api/oauth/google/connect"
          field="locationNames"
          emptyMessage="Nenhum perfil encontrado nesta conta Google."
        />
      </div>
    </div>
  );
}

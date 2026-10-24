import { ChatIdField } from "@/components/ChatIdField";
import { PasswordForm } from "@/components/PasswordForm";
import { ROLE_LABELS, allowedUnitIds } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";

export default async function AccountPage() {
  const s = await requireSession();
  const allowed = await allowedUnitIds(prisma, s);
  const [units, me] = await Promise.all([
    prisma.unit.findMany({
      where: { organizationId: s.organizationId, ...(allowed ? { id: { in: allowed } } : {}) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findUniqueOrThrow({ where: { id: s.userId }, select: { whatsappChatId: true } }),
  ]);
  return (
    <div className="stack lg">
      <div className="page-head"><div><h1>Minha conta</h1><p className="lead">{s.name ?? s.email} · {ROLE_LABELS[s.role]}</p></div></div>
      <div className="grid cols-2">
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Alterar senha</h2>
          <PasswordForm />
        </section>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Suas unidades</h2>
          <p className="muted">{allowed === null ? "Como administrador, você tem acesso a todas as unidades." : "Unidades delegadas a você pelo administrador."}</p>
          {units.length === 0 ? <small>Nenhuma unidade.</small> : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>{units.map((u) => <li key={u.id}>{u.name}</li>)}</ul>
          )}
        </section>
        <section className="card stack">
          <h2 style={{ margin: 0 }}>Meu WhatsApp</h2>
          <p className="muted">Usado pelo botão "Enviar teste para mim" dos Avisos WhatsApp. Alguns números só funcionam no formato antigo de 12 dígitos (sem o nono dígito).</p>
          <ChatIdField endpoint="/api/account/whatsapp" value={me.whatsappChatId} label="Número (formato WAHA)" id="me-chat" hint="Ex.: 554899073477@c.us" />
        </section>
      </div>
    </div>
  );
}

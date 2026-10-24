import Link from "next/link";
import { redirect } from "next/navigation";
import type { NoticeRecurrence, NoticeTargets } from "@fsp/core";
import { IconAlert } from "@/components/Icons";
import { NoticeComposer } from "@/components/NoticeComposer";
import { NoticeHistory } from "@/components/NoticeHistory";
import { NoticeList } from "@/components/NoticeList";
import { isAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { noticePageData } from "@/lib/services/whatsapp-notices";
import { requireSession } from "@/lib/session";

/** Só administradores (spec §8): gestor é redirecionado para o painel; a API responde 403. */
export default async function NoticesPage({ searchParams }: { searchParams: Promise<{ editar?: string }> }) {
  const s = await requireSession();
  if (!isAdmin(s)) redirect("/");
  const sp = await searchParams;
  const data = await noticePageData(prisma, s.organizationId, s.userId);
  const wahaOn = Boolean(process.env.WAHA_URL);
  const aiOn = Boolean(process.env.ANTHROPIC_API_KEY);
  const withoutChat = data.units.filter((u) => !u.whatsappChatId);
  const editing = sp.editar ? data.notices.find((n) => n.id === sp.editar) ?? null : null;

  return (
    <div className="stack lg">
      <div className="page-head">
        <div>
          <h1>Avisos WhatsApp</h1>
          <p className="lead">Escreva um aviso, escolha as unidades e o horário. O envio é feito pelo sistema no horário de Brasília, com histórico por destino.</p>
        </div>
      </div>
      {!wahaOn && <div className="alert warn" role="alert"><IconAlert size="sm" /><span>Envio desabilitado: configure WAHA_URL (e WAHA_API_KEY) no servidor.</span></div>}
      {!data.franchisorChatId && <div className="alert info"><IconAlert size="sm" /><span>O grupo da franqueadora não está cadastrado. <Link href="/unidades">Cadastrar em Unidades e contas</Link>.</span></div>}
      {withoutChat.length > 0 && <div className="alert info"><IconAlert size="sm" /><span>{withoutChat.length} unidade(s) sem grupo WhatsApp não recebem avisos: {withoutChat.map((u) => u.name).join(", ")}. <Link href="/unidades">Cadastrar grupos</Link>.</span></div>}
      {!data.myChatId && <div className="alert info"><IconAlert size="sm" /><span>Para usar &quot;Enviar teste para mim&quot;, cadastre seu número em <Link href="/conta">Minha conta</Link>.</span></div>}

      <NoticeComposer
        key={editing?.id ?? "new"}
        units={data.units}
        hasFranchisor={Boolean(data.franchisorChatId)}
        canTest={wahaOn && Boolean(data.myChatId)}
        aiAvailable={aiOn}
        editing={editing ? { id: editing.id, text: editing.text, targets: editing.targets as unknown as NoticeTargets, firstSendAt: editing.firstSendAt.toISOString(), recurrence: editing.recurrence as unknown as NoticeRecurrence, endAt: editing.endAt?.toISOString() ?? null } : null}
      />
      <NoticeList
        notices={data.notices.map((n) => ({ id: n.id, text: n.text, targets: n.targets as unknown as NoticeTargets, recurrence: n.recurrence as unknown as NoticeRecurrence, nextRunAt: n.nextRunAt?.toISOString() ?? null, state: n.state }))}
        unitNames={Object.fromEntries(data.units.map((u) => [u.id, u.name]))}
      />
      <NoticeHistory rows={data.deliveries.map((d) => ({ id: d.id, sentAt: d.sentAt.toISOString(), targetName: d.targetName, status: d.status, text: d.notice.text, error: d.error }))} />
    </div>
  );
}

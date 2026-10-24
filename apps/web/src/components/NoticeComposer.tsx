"use client";

// Componente client: NUNCA importar a raiz "@fsp/core" (puxa node:crypto). Só subpaths e `import type`.
import { utcToLocal } from "@fsp/core/timezone";
import { NOTICE_TEXT_MAX } from "@fsp/core/whatsapp-notices";
import type { NoticeRecurrence, NoticeTargets } from "@fsp/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { IconAlert, IconCheck } from "./Icons";
import { WEEKDAYS_PT } from "@/lib/format";

const TZ = "America/Sao_Paulo";
const TONES = ["Amigável", "Formal", "Urgente"];

export interface ComposerUnit { id: string; name: string; whatsappChatId: string | null }
export interface EditingNotice { id: string; text: string; targets: NoticeTargets; firstSendAt: string; recurrence: NoticeRecurrence; endAt: string | null }

function minLocal(): string {
  return utcToLocal(new Date(Date.now() + 5 * 60_000), TZ);
}

const HTML_ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

/** Prévia com a formatação do WhatsApp: escapa HTML antes de aplicar *negrito* e _itálico_. */
function previewHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => HTML_ESCAPE[c] ?? c).replace(/\*(.+?)\*/g, "<b>$1</b>").replace(/_(.+?)_/g, "<i>$1</i>").replace(/\n/g, "<br>");
}

export function NoticeComposer({ units, hasFranchisor, canTest, aiAvailable, editing }: { units: ComposerUnit[]; hasFranchisor: boolean; canTest: boolean; aiAvailable: boolean; editing: EditingNotice | null }) {
  const router = useRouter();
  const [text, setText] = useState(editing?.text ?? "");
  const [unidades, setUnidades] = useState<Set<string>>(new Set(editing?.targets.unidades ?? []));
  const [todas, setTodas] = useState(editing?.targets.todas ?? false);
  const [franqueadora, setFranqueadora] = useState(editing?.targets.franqueadora ?? false);
  const [when, setWhen] = useState(editing ? utcToLocal(new Date(editing.firstSendAt), TZ) : "");
  const [tipo, setTipo] = useState<NoticeRecurrence["tipo"]>(editing?.recurrence.tipo ?? "nenhuma");
  const [dias, setDias] = useState<Set<number>>(new Set(editing?.recurrence.tipo === "semanal" ? editing.recurrence.dias : []));
  const [diaMes, setDiaMes] = useState(editing?.recurrence.tipo === "mensal" ? String(editing.recurrence.dia) : "1");
  const [endDate, setEndDate] = useState(editing?.endAt ? utcToLocal(new Date(editing.endAt), TZ).slice(0, 10) : "");
  const [assunto, setAssunto] = useState("");
  const [tom, setTom] = useState(TONES[0] ?? "Amigável");
  const [busy, setBusy] = useState<"save" | "test" | "ai" | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});

  const available = useMemo(() => units.filter((u) => u.whatsappChatId), [units]);
  const count = todas ? available.length : [...unidades].filter((id) => available.some((u) => u.id === id)).length;
  const diaMesOk = diaMes.trim().toLowerCase() === "ultimo" || (/^\d{1,2}$/.test(diaMes.trim()) && Number(diaMes) >= 1 && Number(diaMes) <= 31);
  const blocker =
    text.trim() === "" ? "Escreva o texto."
    : count === 0 && !franqueadora ? "Escolha ao menos um destino."
    : !when ? "Escolha data e hora."
    : tipo === "semanal" && dias.size === 0 ? "Marque ao menos um dia da semana."
    : tipo === "mensal" && !diaMesOk ? 'Dia do mês: 1 a 31 ou "ultimo".'
    : null;

  function body() {
    const recurrence: NoticeRecurrence =
      tipo === "semanal" ? { tipo, dias: [...dias].sort((a, b) => a - b) }
      : tipo === "mensal" ? { tipo, dia: diaMes.trim().toLowerCase() === "ultimo" ? "ultimo" : Number(diaMes) }
      : { tipo };
    return { text, targets: { unidades: todas ? [] : [...unidades], todas, franqueadora }, firstSendLocal: when, recurrence, endDate: endDate || null };
  }

  async function call(kind: "save" | "test" | "ai") {
    setBusy(kind);
    setMsg({});
    const [url, method, payload] =
      kind === "save" ? [editing ? `/api/whatsapp-notices/${editing.id}` : "/api/whatsapp-notices", editing ? "PATCH" : "POST", body()]
      : kind === "test" ? ["/api/whatsapp-notices/test", "POST", { text }]
      : ["/api/whatsapp-notices/generate", "POST", { assunto, tom }];
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = (await res.json().catch(() => ({}))) as { error?: string; text?: string; details?: { fieldErrors?: Record<string, string[]> } | null };
    setBusy(null);
    if (!res.ok) {
      // Erro de validação do zod vem como "Dados inválidos" + fieldErrors: mostra o primeiro campo, como o ChatIdField.
      const field = Object.entries(data.details?.fieldErrors ?? {}).find(([, v]) => v.length > 0);
      setMsg({ error: field ? `${field[0]}: ${field[1][0]}` : data.error ?? "Erro" });
      return;
    }
    if (kind === "ai") { setText(data.text ?? ""); setMsg({ ok: "Texto gerado. Revise antes de agendar." }); return; }
    if (kind === "test") { setMsg({ ok: "Teste enviado para o seu número." }); return; }
    setMsg({ ok: editing ? "Aviso atualizado." : "Aviso agendado." });
    if (editing) router.push("/avisos");
    else { setText(""); setAssunto(""); }
    router.refresh();
  }

  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  return (
    <div className="grid composer">
      <div className="card stack lg">
        {editing && <div className="alert info"><IconAlert size="sm" /><span>Editando um aviso existente. <Link href="/avisos">Cancelar edição</Link></span></div>}
        <section className="section">
          <h2 className="section-title"><span className="num">1</span> Texto</h2>
          <div className="field">
            <label htmlFor="notice-text">Mensagem (formatação do WhatsApp: *negrito*, _itálico_)</label>
            <textarea id="notice-text" value={text} maxLength={NOTICE_TEXT_MAX} onChange={(e) => setText(e.target.value)} rows={6} />
            <small className="hint">{[...text].length}/{NOTICE_TEXT_MAX}</small>
          </div>
          {text && <div className="card tight" aria-label="Prévia" dangerouslySetInnerHTML={{ __html: previewHtml(text) }} />}
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="muted">Gerar com IA</legend>
            <div className="row">
              <input type="text" value={assunto} onChange={(e) => setAssunto(e.target.value)} placeholder="Assunto (ex.: lembrete de fechamento de caixa toda sexta)" style={{ flex: 1, minWidth: 240 }} aria-label="Assunto" />
              <select value={tom} onChange={(e) => setTom(e.target.value)} aria-label="Tom">{TONES.map((t) => <option key={t}>{t}</option>)}</select>
              <button type="button" className="btn" disabled={!aiAvailable || busy !== null || assunto.trim() === ""} title={aiAvailable ? undefined : "Configure ANTHROPIC_API_KEY no servidor"} onClick={() => call("ai")}>{busy === "ai" ? <span className="spinner" aria-hidden="true" /> : null} Gerar com IA</button>
            </div>
          </fieldset>
        </section>

        <section className="section">
          <h2 className="section-title"><span className="num">2</span> Destinos</h2>
          <div className="row">
            <label className={`chip ${todas ? "on" : ""}`}><input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} /> Todas as unidades ({available.length})</label>
            <label className={`chip ${franqueadora ? "on" : ""}`} title={hasFranchisor ? undefined : "Cadastre o grupo da franqueadora em Unidades e contas"}><input type="checkbox" checked={franqueadora} disabled={!hasFranchisor} onChange={(e) => setFranqueadora(e.target.checked)} /> Franqueadora</label>
          </div>
          {!todas && (
            <div className="row">
              {units.map((u) => (
                <label key={u.id} className={`chip ${unidades.has(u.id) ? "on" : ""}`} title={u.whatsappChatId ? u.whatsappChatId : "Sem grupo WhatsApp cadastrado"}>
                  {/* Sem grupo não dá para marcar; mas uma unidade já marcada que perdeu o grupo continua desmarcável. */}
                  <input type="checkbox" checked={unidades.has(u.id)} disabled={!u.whatsappChatId && !unidades.has(u.id)} onChange={() => setUnidades((s) => toggle(s, u.id))} /> {u.name}
                </label>
              ))}
            </div>
          )}
        </section>

        <section className="section">
          <h2 className="section-title"><span className="num">3</span> Quando</h2>
          <div className="grid cols-3">
            <div className="field"><label htmlFor="notice-when">Primeiro envio (horário de Brasília)</label><input id="notice-when" type="datetime-local" value={when} min={minLocal()} onChange={(e) => setWhen(e.target.value)} required /></div>
            <div className="field"><label htmlFor="notice-rec">Repetição</label>
              <select id="notice-rec" value={tipo} onChange={(e) => setTipo(e.target.value as NoticeRecurrence["tipo"])}>
                <option value="nenhuma">Nenhuma</option><option value="diaria">Diária</option><option value="semanal">Semanal</option><option value="mensal">Mensal</option>
              </select>
            </div>
            <div className="field"><label htmlFor="notice-end">Até (opcional)</label><input id="notice-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
          </div>
          {tipo === "semanal" && (
            <div className="row">{WEEKDAYS_PT.map((n, i) => <label key={i} className={`chip ${dias.has(i) ? "on" : ""}`}><input type="checkbox" checked={dias.has(i)} onChange={() => setDias((s) => { const d = new Set(s); if (d.has(i)) d.delete(i); else d.add(i); return d; })} /> {n}</label>)}</div>
          )}
          {tipo === "mensal" && (
            <div className="field" style={{ maxWidth: 240 }}><label htmlFor="notice-dia">Dia do mês (1–31 ou &quot;ultimo&quot;)</label><input id="notice-dia" type="text" value={diaMes} onChange={(e) => setDiaMes(e.target.value)} /></div>
          )}
        </section>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>Resumo</h2>
        <p className="muted">
          {count > 0 || franqueadora ? `${todas ? "Todas as unidades" : `${count} unidade(s)`}${franqueadora ? " + franqueadora" : ""}` : "Nenhum destino"} · {tipo === "nenhuma" ? "envio único" : `repetição ${tipo}`}{endDate ? ` até ${endDate.split("-").reverse().join("/")}` : ""}
        </p>
        {msg.error && <div className="alert error" role="alert"><IconAlert size="sm" /><span>{msg.error}</span></div>}
        {msg.ok && <div className="alert ok" role="status"><IconCheck size="sm" /><span>{msg.ok}</span></div>}
        <div className="action-bar">
          <button className="btn primary" type="button" disabled={busy !== null || blocker !== null} onClick={() => call("save")}>{busy === "save" ? <span className="spinner" aria-hidden="true" /> : null} {editing ? "Salvar alterações" : "Agendar aviso"}</button>
          <button className="btn" type="button" disabled={busy !== null || !canTest || text.trim() === ""} title={canTest ? undefined : "Cadastre seu número em Minha conta (e WAHA_URL no servidor)"} onClick={() => call("test")}>{busy === "test" ? <span className="spinner" aria-hidden="true" /> : null} Enviar teste para mim</button>
          {blocker && <small className="why">{blocker}</small>}
        </div>
      </div>
    </div>
  );
}

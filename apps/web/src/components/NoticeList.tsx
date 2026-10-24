"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { NoticeRecurrence, NoticeTargets } from "@fsp/core";
import { IconX } from "./Icons";
import { NOTICE_STATE_LABELS, describeRecurrence, formatInTz, shorten } from "@/lib/format";

export interface NoticeRow { id: string; text: string; targets: NoticeTargets; recurrence: NoticeRecurrence; nextRunAt: string | null; state: string }

/** "Próximos envios": avisos ativos/pausados/enviando com pausar, retomar, editar e cancelar. */
export function NoticeList({ notices, unitNames }: { notices: NoticeRow[]; unitNames: Record<string, string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setState(id: string, state: "ativo" | "pausado" | "cancelado") {
    if (state === "cancelado" && !confirm("Cancelar este aviso?")) return;
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/whatsapp-notices/${id}/state`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
    setBusy(null);
    if (!res.ok) { const b = (await res.json().catch(() => ({}))) as { error?: string }; setError(b.error ?? "Erro"); return; }
    router.refresh();
  }

  const describeTargets = (t: NoticeTargets) => `${t.todas ? "todas as unidades" : `${t.unidades.length} unid. (${t.unidades.map((id) => unitNames[id] ?? "?").join(", ")})`}${t.franqueadora ? " + franqueadora" : ""}`;

  return (
    <section className="card stack" aria-labelledby="proximos">
      <h2 id="proximos" style={{ margin: 0 }}>Próximos envios</h2>
      {error && <div className="alert error" role="alert">{error}</div>}
      {notices.length === 0 ? (
        <div className="empty"><strong>Nenhum aviso agendado</strong><span>Use o formulário acima para agendar o primeiro.</span></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Próximo</th><th>Texto</th><th>Destinos</th><th>Repetição</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {notices.map((n) => {
                const st = NOTICE_STATE_LABELS[n.state] ?? { label: n.state, badge: "" };
                return (
                  <tr key={n.id}>
                    <td>{n.nextRunAt ? formatInTz(new Date(n.nextRunAt), "America/Sao_Paulo") : "—"}</td>
                    <td title={n.text}>{shorten(n.text)}</td>
                    <td>{describeTargets(n.targets)}</td>
                    <td>{describeRecurrence(n.recurrence)}</td>
                    <td><span className={`badge ${st.badge}`}>{st.label}</span></td>
                    <td className="actions">
                      {n.state === "enviando" ? <em>enviando…</em> : (
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                          {n.state === "ativo" && <button type="button" className="btn small" disabled={busy === n.id} onClick={() => setState(n.id, "pausado")}>Pausar</button>}
                          {n.state === "pausado" && <button type="button" className="btn small" disabled={busy === n.id} onClick={() => setState(n.id, "ativo")}>Retomar</button>}
                          <Link className="btn small" href={`/avisos?editar=${n.id}`}>Editar</Link>
                          <button type="button" className="btn small danger" disabled={busy === n.id} onClick={() => setState(n.id, "cancelado")}><IconX size="sm" /> Cancelar</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

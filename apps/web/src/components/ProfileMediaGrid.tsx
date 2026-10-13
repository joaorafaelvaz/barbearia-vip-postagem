"use client";

import type { IgMediaItem, IgMediaPage } from "@fsp/connectors";
import { useState } from "react";
import { CommentsDialog } from "./CommentsDialog";
import { IconAlert, IconImage, IconLink, IconVideo, IconX } from "./Icons";

const TYPE_LABEL: Record<string, string> = { IMAGE: "Foto", VIDEO: "Vídeo", CAROUSEL_ALBUM: "Carrossel" };

function when(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `Falha (HTTP ${res.status})`;
}

/** Grade das publicações do perfil com ações: ver, comentários, excluir. */
export function ProfileMediaGrid({ accountId, initial }: { accountId: string; initial: IgMediaPage }) {
  const [items, setItems] = useState<IgMediaItem[]>(initial.items);
  const [next, setNext] = useState<string | undefined>(initial.next);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<IgMediaItem | null>(null);

  async function loadMore() {
    if (!next) return;
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/profiles/${accountId}/media?after=${encodeURIComponent(next)}`);
    if (!res.ok) { setError(await readError(res)); setLoading(false); return; }
    const page = (await res.json()) as IgMediaPage;
    setItems((list) => [...list, ...page.items.filter((m) => !list.some((x) => x.id === m.id))]);
    setNext(page.next);
    setLoading(false);
  }

  async function remove(m: IgMediaItem) {
    const kind = TYPE_LABEL[m.mediaType] ?? "publicação";
    if (!confirm(`Excluir esta ${kind.toLowerCase()} do Instagram? Não dá para desfazer.`)) return;
    setBusyId(m.id);
    setError(null);
    const res = await fetch(`/api/profiles/${accountId}/media/${m.id}`, { method: "DELETE" });
    if (!res.ok) setError(await readError(res));
    else setItems((list) => list.filter((x) => x.id !== m.id));
    setBusyId(null);
  }

  return (
    <div className="stack">
      {error && <div className="alert error" role="alert"><IconAlert size="sm" /><span>{error}</span></div>}
      {items.length === 0 ? (
        <div className="card"><div className="empty"><IconImage /><strong>Nenhuma publicação</strong><span>As publicações do perfil aparecem aqui.</span></div></div>
      ) : (
        <ul className="pf-grid" aria-label="Publicações">
          {items.map((m) => {
            const thumb = m.mediaType === "VIDEO" ? m.thumbnailUrl ?? m.mediaUrl : m.mediaUrl;
            return (
              <li key={m.id} className="pf-item card tight">
                <div className="pf-thumb">
                  {thumb ? <img src={thumb} alt="" loading="lazy" /> : <span className="pf-nothumb"><IconImage /></span>}
                  <span className="pf-type">{m.mediaType === "VIDEO" ? <IconVideo size="sm" /> : null}{TYPE_LABEL[m.mediaType] ?? m.mediaType}</span>
                </div>
                <div className="pf-meta">
                  <small className="muted">{when(m.timestamp)} · ♥ {m.likeCount.toLocaleString("pt-BR")} · 💬 {m.commentsCount.toLocaleString("pt-BR")}</small>
                  <p className="pf-caption">{m.caption || <span className="muted">(sem legenda)</span>}</p>
                </div>
                <div className="row pf-actions">
                  <button type="button" className="btn small" onClick={() => setOpen(m)}>Comentários{m.commentsCount > 0 ? ` (${m.commentsCount})` : ""}</button>
                  {m.permalink && <a className="btn small ghost" href={m.permalink} target="_blank" rel="noreferrer" title="Abrir no Instagram"><IconLink size="sm" /> Ver</a>}
                  <button type="button" className="btn small danger" disabled={busyId === m.id} onClick={() => remove(m)} title="Excluir no Instagram">
                    {busyId === m.id ? <span className="spinner" aria-hidden="true" /> : <IconX size="sm" />} Excluir
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {next && (
        <div className="row" style={{ justifyContent: "center" }}>
          <button type="button" className="btn" disabled={loading} onClick={loadMore}>{loading ? "Carregando..." : "Carregar mais"}</button>
        </div>
      )}
      {open && <CommentsDialog accountId={accountId} media={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

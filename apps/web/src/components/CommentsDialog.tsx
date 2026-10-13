"use client";

import type { IgComment, IgMediaItem } from "@fsp/connectors";
import { useEffect, useRef, useState } from "react";
import { IconAlert, IconX } from "./Icons";

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `Falha (HTTP ${res.status})`;
}

function when(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

interface Props {
  accountId: string;
  media: IgMediaItem;
  onClose: () => void;
}

/** Comentários de uma publicação: responder, ocultar/mostrar e excluir. */
export function CommentsDialog({ accountId, media, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [comments, setComments] = useState<IgComment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setError(null);
    const res = await fetch(`/api/profiles/${accountId}/media/${media.id}/comments`);
    if (!res.ok) { setError(await readError(res)); setComments([]); return; }
    setComments(((await res.json()) as { comments: IgComment[] }).comments);
  }

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media.id]);

  async function act(id: string, run: () => Promise<Response>) {
    setBusy(id);
    setError(null);
    const res = await run();
    if (!res.ok) setError(await readError(res));
    else await load();
    setBusy(null);
  }

  const reply = (c: IgComment) => act(c.id, () => fetch(`/api/profiles/${accountId}/comments/${c.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) })).then(() => { setReplyTo(null); setText(""); });
  const hide = (c: IgComment) => act(c.id, () => fetch(`/api/profiles/${accountId}/comments/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hidden: !c.hidden }) }));
  const remove = (c: IgComment) => { if (confirm("Excluir este comentário? Não dá para desfazer.")) void act(c.id, () => fetch(`/api/profiles/${accountId}/comments/${c.id}`, { method: "DELETE" })); };

  function Item({ c, depth }: { c: IgComment; depth: number }) {
    return (
      <li className={`pf-comment ${c.hidden ? "hidden" : ""}`} style={{ marginLeft: depth * 24 }}>
        <div className="row between" style={{ alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <strong>@{c.username ?? "usuário"}</strong> <small className="muted">{when(c.timestamp)}{c.hidden ? " · oculto" : ""}{c.likeCount ? ` · ♥ ${c.likeCount}` : ""}</small>
            <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{c.text}</p>
          </div>
          <div className="row" style={{ flexShrink: 0 }}>
            <button type="button" className="btn small" disabled={busy === c.id} onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setText(""); }}>Responder</button>
            {depth === 0 && <button type="button" className="btn small ghost" disabled={busy === c.id} onClick={() => hide(c)}>{c.hidden ? "Mostrar" : "Ocultar"}</button>}
            <button type="button" className="btn small danger" disabled={busy === c.id} onClick={() => remove(c)}>Excluir</button>
          </div>
        </div>
        {replyTo === c.id && (
          <form className="pf-reply" onSubmit={(e) => { e.preventDefault(); void reply(c); }}>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={`Responder a @${c.username ?? "usuário"}`} rows={2} maxLength={2200} required />
            <div className="row">
              <button type="submit" className="btn primary small" disabled={busy === c.id || text.trim() === ""}>{busy === c.id ? "Enviando..." : "Enviar resposta"}</button>
              <button type="button" className="btn small ghost" onClick={() => setReplyTo(null)}>Cancelar</button>
            </div>
          </form>
        )}
        {c.replies.length > 0 && <ul className="pf-comments">{c.replies.map((r) => <Item key={r.id} c={r} depth={depth + 1} />)}</ul>}
      </li>
    );
  }

  return (
    <dialog ref={ref} className="pf-dialog" onClose={onClose} aria-label="Comentários da publicação">
      <div className="pf-dialog-head">
        <strong>Comentários</strong>
        <small className="muted" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{media.caption || "(sem legenda)"}</small>
        <button type="button" className="btn small icon-only" onClick={() => ref.current?.close()} aria-label="Fechar"><IconX size="sm" /></button>
      </div>
      {error && <div className="alert error" role="alert"><IconAlert size="sm" /><span>{error}</span></div>}
      {comments === null ? (
        <p className="muted">Carregando comentários...</p>
      ) : comments.length === 0 ? (
        <p className="muted">Nenhum comentário nesta publicação.</p>
      ) : (
        <ul className="pf-comments">{comments.map((c) => <Item key={c.id} c={c} depth={0} />)}</ul>
      )}
    </dialog>
  );
}

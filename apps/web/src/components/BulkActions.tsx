"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconRetry, IconX } from "./Icons";

interface Scope { postId?: string; from?: string; to?: string }

interface Props {
  scope: Scope;
  /** contagens para mostrar/ocultar cada botão */
  retryable: number;
  cancellable: number;
  /** mostra "Excluir postagem" (só no detalhe) */
  allowDelete?: boolean;
  compact?: boolean;
}

export function BulkActions({ scope, retryable, cancellable, allowDelete = false, compact = false }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function bulk(action: "retry" | "cancel") {
    const what = action === "retry" ? `Re-tentar agora ${retryable} publicação(ões) com falha ou cancelada(s)?` : `Cancelar ${cancellable} publicação(ões) ainda não publicada(s)?`;
    if (!confirm(what)) return;
    setBusy(action);
    setMsg(null);
    const res = await fetch("/api/targets/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...scope }) });
    setBusy(null);
    const body = (await res.json().catch(() => ({}))) as { count?: number; error?: string };
    setMsg(res.ok ? `${body.count ?? 0} publicação(ões) ${action === "retry" ? "reenfileirada(s)" : "cancelada(s)"}.` : body.error ?? "Erro");
    if (res.ok) router.refresh();
  }

  async function remove() {
    if (!scope.postId) return;
    if (!confirm("Excluir esta postagem e todo o seu histórico de publicações?\nO que já foi publicado nas plataformas continua lá. Esta ação não pode ser desfeita.")) return;
    setBusy("delete");
    const res = await fetch(`/api/posts/${scope.postId}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) { const b = (await res.json().catch(() => ({}))) as { error?: string }; setMsg(b.error ?? "Erro ao excluir"); return; }
    router.push("/");
    router.refresh();
  }

  const size = compact ? "btn small" : "btn";
  return (
    <div className="row" style={{ gap: 8 }}>
      {retryable > 0 && <button className={size} disabled={busy !== null} onClick={() => bulk("retry")}><IconRetry size="sm" /> Re-tentar todas ({retryable})</button>}
      {cancellable > 0 && <button className={`${size} danger`} disabled={busy !== null} onClick={() => bulk("cancel")}><IconX size="sm" /> Cancelar pendentes ({cancellable})</button>}
      {allowDelete && <button className={`${size} danger`} disabled={busy !== null} onClick={remove}><IconX size="sm" /> Excluir postagem</button>}
      {msg && <small role="status">{msg}</small>}
    </div>
  );
}

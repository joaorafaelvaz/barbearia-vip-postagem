"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconX } from "./Icons";

interface Summary { unit: { name: string }; accounts: number; scheduled: number; published: number }

export function DeleteUnitButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const info = await fetch(`/api/units/${id}`).then((r) => (r.ok ? (r.json() as Promise<Summary>) : null)).catch(() => null);
    const lines = [
      `Remover a unidade "${name}"?`,
      info ? `• ${info.accounts} conta(s) conectada(s) serão desvinculadas` : "",
      info && info.scheduled > 0 ? `• ${info.scheduled} publicação(ões) agendada(s) serão canceladas` : "",
      info && info.published > 0 ? `• o histórico de ${info.published} publicação(ões) será apagado` : "",
      "Esta ação não pode ser desfeita.",
    ].filter(Boolean);
    if (!confirm(lines.join("\n"))) {
      setBusy(false);
      return;
    }
    const res = await fetch(`/api/units/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Não foi possível remover.");
      return;
    }
    router.refresh();
  }

  return (
    <span className="row" style={{ gap: 6 }}>
      <button className="btn small danger" disabled={busy} onClick={run} aria-label={`Remover unidade ${name}`}>
        <IconX size="sm" /> Remover
      </button>
      {error && <small style={{ color: "var(--err)" }} role="alert">{error}</small>}
    </span>
  );
}

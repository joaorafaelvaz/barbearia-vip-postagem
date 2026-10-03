"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconRetry, IconX } from "./Icons";

type Action = "retry" | "cancel";

export function TargetActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(action: Action) {
    setBusy(action);
    setError(null);
    const res = await fetch(`/api/targets/${id}/${action}`, { method: "POST" });
    setBusy(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Erro");
      return;
    }
    router.refresh();
  }

  const canRetry = status === "FAILED" || status === "CANCELLED";
  const canStop = status === "SCHEDULED" || status === "FAILED";
  if (!canRetry && !canStop) return null;

  return (
    <div className="row" style={{ justifyContent: "flex-end" }}>
      {canRetry && (
        <button className="btn small" disabled={busy !== null} onClick={() => call("retry")}>
          {busy === "retry" ? <span className="spinner" aria-hidden="true" /> : <IconRetry size="sm" />} Re-tentar
        </button>
      )}
      {canStop && (
        <button className="btn small danger" disabled={busy !== null} onClick={() => call("cancel")}>
          {busy === "cancel" ? <span className="spinner" aria-hidden="true" /> : <IconX size="sm" />} Cancelar
        </button>
      )}
      {error && <small style={{ color: "var(--err)" }} role="alert">{error}</small>}
    </div>
  );
}

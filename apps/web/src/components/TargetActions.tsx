"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Action = "retry" | "cancel";

export function TargetActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(action: Action) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/targets/${id}/${action}`, { method: "POST" });
    setBusy(false);
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
    <div className="row">
      {canRetry && (
        <button className="btn small" disabled={busy} onClick={() => call("retry")}>
          Re-tentar agora
        </button>
      )}
      {canStop && (
        <button className="btn small danger" disabled={busy} onClick={() => call("cancel")}>
          Cancelar
        </button>
      )}
      {error && <small style={{ color: "var(--err)" }}>{error}</small>}
    </div>
  );
}

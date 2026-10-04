"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IconRetry } from "./Icons";

export function RefreshMetricsButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "queued" | "error">("idle");

  useEffect(() => {
    if (state !== "queued") return;
    const t = setTimeout(() => { router.refresh(); setState("idle"); }, 20_000);
    return () => clearTimeout(t);
  }, [state, router]);

  async function run() {
    setState("idle");
    const res = await fetch("/api/analytics/refresh", { method: "POST" });
    setState(res.ok ? "queued" : "error");
  }

  return (
    <span className="row" style={{ gap: 8 }}>
      <button className="btn small" onClick={run} disabled={state === "queued"}>
        <IconRetry size="sm" /> {state === "queued" ? "Coletando..." : "Atualizar métricas"}
      </button>
      {state === "queued" && <small>Buscando nas plataformas; a página recarrega em instantes.</small>}
      {state === "error" && <small style={{ color: "var(--err)" }}>Não foi possível iniciar a coleta.</small>}
    </span>
  );
}

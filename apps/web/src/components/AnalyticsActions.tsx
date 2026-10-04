"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IconRetry, IconUpload } from "./Icons";

type Job = "metrics" | "import";
const LABEL: Record<Job, { idle: string; busy: string; hint: string }> = {
  metrics: { idle: "Atualizar métricas", busy: "Coletando...", hint: "Buscando engajamento nas plataformas; a página recarrega em instantes." },
  import: { idle: "Importar publicações", busy: "Importando...", hint: "Lendo as publicações dos últimos 90 dias de cada conta; a página recarrega em instantes." },
};

export function AnalyticsActions() {
  const router = useRouter();
  const [running, setRunning] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => { router.refresh(); setRunning(null); }, running === "import" ? 30_000 : 20_000);
    return () => clearTimeout(t);
  }, [running, router]);

  async function run(job: Job) {
    setError(null);
    const res = await fetch(job === "metrics" ? "/api/analytics/refresh" : "/api/analytics/import", { method: "POST" });
    if (!res.ok) { setError("Não foi possível iniciar."); return; }
    setRunning(job);
  }

  return (
    <div className="stack" style={{ alignItems: "flex-end", gap: 6 }}>
      <div className="row">
        <button className="btn small" onClick={() => run("import")} disabled={running !== null}><IconUpload size="sm" /> {running === "import" ? LABEL.import.busy : LABEL.import.idle}</button>
        <button className="btn small" onClick={() => run("metrics")} disabled={running !== null}><IconRetry size="sm" /> {running === "metrics" ? LABEL.metrics.busy : LABEL.metrics.idle}</button>
      </div>
      {running && <small>{LABEL[running].hint}</small>}
      {error && <small style={{ color: "var(--err)" }}>{error}</small>}
    </div>
  );
}

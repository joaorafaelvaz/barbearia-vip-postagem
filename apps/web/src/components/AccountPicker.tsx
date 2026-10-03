"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface PickerOption {
  id: string;
  title: string;
  subtitle?: string;
}

interface Props {
  unitId: string;
  options: PickerOption[];
  endpoint: string;
  /** nome do campo com os ids escolhidos no body (pageIds | locationNames) */
  field: string;
  emptyMessage: string;
}

/** Lista de Pages (Meta) ou locations (Google) para vincular a uma unidade. */
export function AccountPicker({ unitId, options, endpoint, field, emptyMessage }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(options.length === 1 ? [options[0]!.id] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function connect() {
    setBusy(true);
    setError(null);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitId, [field]: selected }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Erro ao conectar");
      return;
    }
    router.push("/unidades?ok=1");
    router.refresh();
  }

  if (options.length === 0) return <div className="alert warn">{emptyMessage}</div>;

  return (
    <div className="stack">
      {options.map((o) => (
        <label key={o.id} className={`chip ${selected.includes(o.id) ? "on" : ""}`} style={{ justifyContent: "flex-start", padding: "10px 12px", borderRadius: 8 }}>
          <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
          <span>
            <strong>{o.title}</strong>
            {o.subtitle && <><br /><small>{o.subtitle}</small></>}
          </span>
        </label>
      ))}
      {error && <div className="alert error">{error}</div>}
      <div>
        <button className="btn primary" disabled={busy || selected.length === 0} onClick={connect}>
          Vincular {selected.length > 0 ? `(${selected.length})` : ""} a esta unidade
        </button>
      </div>
    </div>
  );
}

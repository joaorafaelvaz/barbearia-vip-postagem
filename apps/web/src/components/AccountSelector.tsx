"use client";

import { PLATFORM_LABELS, type Platform } from "@fsp/core/platforms";
import { useMemo } from "react";

export interface ComposerUnit {
  id: string;
  name: string;
  timezone: string;
  accounts: Array<{ id: string; platform: Platform; displayName: string }>;
}

interface Props {
  units: ComposerUnit[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

export function AccountSelector({ units, selected, onChange }: Props) {
  const allAccountIds = useMemo(() => units.flatMap((u) => u.accounts.map((a) => a.id)), [units]);
  const platformsAvailable = [...new Set(units.flatMap((u) => u.accounts.map((a) => a.platform)))];

  function toggle(id: string) {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    onChange(n);
  }
  function toggleMany(ids: string[]) {
    const all = ids.every((id) => selected.has(id));
    const n = new Set(selected);
    for (const id of ids) all ? n.delete(id) : n.add(id);
    onChange(n);
  }
  function selectAll() {
    onChange(selected.size === allAccountIds.length ? new Set() : new Set(allAccountIds));
  }

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>Unidades e contas</strong>
        <button className="btn small" onClick={selectAll}>{selected.size === allAccountIds.length ? "Limpar" : "Selecionar todas"}</button>
      </div>
      <div className="row">
        {platformsAvailable.map((p) => (
          <button key={p} className="btn small" onClick={() => toggleMany(units.flatMap((u) => u.accounts.filter((a) => a.platform === p).map((a) => a.id)))}>
            Todas: {PLATFORM_LABELS[p]}
          </button>
        ))}
      </div>
      {units.length === 0 && <small>Cadastre unidades e conecte contas em “Unidades e contas”.</small>}
      {units.map((u) => (
        <div className="unit-pick" key={u.id}>
          <header>
            <span>{u.name} <small>({u.timezone})</small></span>
            {u.accounts.length > 0 && <button className="btn small" onClick={() => toggleMany(u.accounts.map((a) => a.id))}>Toda a unidade</button>}
          </header>
          <div className="accounts">
            {u.accounts.length === 0 && <small>Sem contas conectadas</small>}
            {u.accounts.map((a) => (
              <label key={a.id} className={`chip ${selected.has(a.id) ? "on" : ""}`}>
                <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                {PLATFORM_LABELS[a.platform]} · {a.displayName}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

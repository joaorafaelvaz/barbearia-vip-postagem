"use client";

import { PLATFORM_LABELS, type Platform } from "@fsp/core/platforms";
import Link from "next/link";
import { useMemo } from "react";
import { IconStore, PlatformIcon } from "./Icons";

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
  step?: number;
}

export function AccountSelector({ units, selected, onChange, step = 3 }: Props) {
  const allAccountIds = useMemo(() => units.flatMap((u) => u.accounts.map((a) => a.id)), [units]);
  const platformsAvailable = [...new Set(units.flatMap((u) => u.accounts.map((a) => a.platform)))];
  const allSelected = allAccountIds.length > 0 && selected.size === allAccountIds.length;

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

  return (
    <div className="card stack" aria-labelledby="sel-title">
      <div className="row between">
        <h2 className="section-title" id="sel-title"><span className="num">{step}</span> Onde publicar <small style={{ fontWeight: 500 }}>{selected.size}/{allAccountIds.length}</small></h2>
        {allAccountIds.length > 0 && (
          <button type="button" className="btn small" onClick={() => onChange(allSelected ? new Set() : new Set(allAccountIds))}>
            {allSelected ? "Limpar seleção" : "Selecionar todas"}
          </button>
        )}
      </div>
      {platformsAvailable.length > 1 && (
        <div className="row" role="group" aria-label="Selecionar por plataforma">
          {platformsAvailable.map((p) => {
            const ids = units.flatMap((u) => u.accounts.filter((a) => a.platform === p).map((a) => a.id));
            const on = ids.every((id) => selected.has(id));
            return (
              <button key={p} type="button" className={`chip ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggleMany(ids)}>
                <PlatformIcon platform={p} size="sm" /> Todas: {PLATFORM_LABELS[p]}
              </button>
            );
          })}
        </div>
      )}
      {units.length === 0 && (
        <div className="empty">
          <IconStore />
          <strong>Nenhuma unidade cadastrada</strong>
          <span>Cadastre as unidades e conecte as contas de cada uma para poder agendar.</span>
          <Link className="btn" href="/unidades">Ir para unidades e contas</Link>
        </div>
      )}
      {units.map((u) => {
        const ids = u.accounts.map((a) => a.id);
        const picked = ids.filter((id) => selected.has(id)).length;
        return (
          <fieldset className="unit-pick" key={u.id} style={{ margin: 0 }}>
            <header>
              <legend style={{ padding: 0, float: "left" }}>
                {u.name} <span className="count">{u.accounts.length > 0 ? `${picked}/${u.accounts.length}` : "sem contas"} · {u.timezone.replace("America/", "")}</span>
              </legend>
              {u.accounts.length > 0 && (
                <button type="button" className="btn small ghost" onClick={() => toggleMany(ids)}>
                  {picked === ids.length ? "Desmarcar" : "Toda a unidade"}
                </button>
              )}
            </header>
            <div className="accounts">
              {u.accounts.length === 0 && <small>Conecte contas em “Unidades e contas”.</small>}
              {u.accounts.map((a) => (
                <label key={a.id} className={`chip ${selected.has(a.id) ? "on" : ""}`}>
                  <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                  <PlatformIcon platform={a.platform} size="sm" />
                  <span className="visually-hidden">{PLATFORM_LABELS[a.platform]}: </span>
                  <span>{a.displayName}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

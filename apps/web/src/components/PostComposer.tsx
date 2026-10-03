"use client";

import { CAPTION_LIMITS, PLATFORM_LABELS, type Platform } from "@fsp/core/platforms";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export interface ComposerUnit {
  id: string;
  name: string;
  timezone: string;
  accounts: Array<{ id: string; platform: Platform; displayName: string }>;
}

interface Uploaded {
  id: string;
  publicUrl: string;
  issues: Array<{ platform: Platform; message: string }>;
}

export function PostComposer({ units }: { units: ComposerUnit[] }) {
  const router = useRouter();
  const [caption, setCaption] = useState("");
  const [when, setWhen] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [media, setMedia] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allAccountIds = useMemo(() => units.flatMap((u) => u.accounts.map((a) => a.id)), [units]);
  const selectedPlatforms = useMemo(() => {
    const set = new Set<Platform>();
    for (const u of units) for (const a of u.accounts) if (selected.has(a.id)) set.add(a.platform);
    return [...set];
  }, [units, selected]);
  const captionLen = [...caption].length;
  const mediaIssues = media.flatMap((m) => m.issues.filter((i) => selectedPlatforms.includes(i.platform)));

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function toggleUnit(u: ComposerUnit) {
    const ids = u.accounts.map((a) => a.id);
    const all = ids.every((id) => selected.has(id));
    setSelected((s) => {
      const n = new Set(s);
      for (const id of ids) all ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function selectAll() {
    setSelected(selected.size === allAccountIds.length ? new Set() : new Set(allAccountIds));
  }
  function togglePlatform(p: Platform) {
    const ids = units.flatMap((u) => u.accounts.filter((a) => a.platform === p).map((a) => a.id));
    const all = ids.every((id) => selected.has(id));
    setSelected((s) => {
      const n = new Set(s);
      for (const id of ids) all ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function onFiles(files: FileList | null) {
    if (!files) return;
    setUploading(true);
    setError(null);
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/media", { method: "POST", body: fd });
      const body = (await res.json()) as Uploaded & { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Falha no upload");
        continue;
      }
      setMedia((m) => [...m, body]);
    }
    setUploading(false);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption, scheduledLocal: when, mediaIds: media.map((m) => m.id), accountIds: [...selected] }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Erro ao agendar");
      return;
    }
    router.push("/?ok=1");
    router.refresh();
  }

  const platformsAvailable = [...new Set(units.flatMap((u) => u.accounts.map((a) => a.platform)))];

  return (
    <div className="grid cols-2">
      <div className="card stack">
        <div>
          <label htmlFor="caption">Texto da postagem</label>
          <textarea id="caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Escreva a legenda que será publicada em todas as contas selecionadas" />
          <small>
            {captionLen} caracteres
            {selectedPlatforms.map((p) => (
              <span key={p} style={{ marginLeft: 10, color: captionLen > CAPTION_LIMITS[p] ? "var(--err)" : undefined }}>
                {PLATFORM_LABELS[p]}: máx. {CAPTION_LIMITS[p]}
              </span>
            ))}
          </small>
        </div>
        <div>
          <label htmlFor="media">Imagens (JPG recomendado; Instagram exige imagem)</label>
          <input id="media" type="file" accept="image/jpeg,image/png,image/gif" multiple onChange={(e) => onFiles(e.target.files)} disabled={uploading} />
          {media.length > 0 && (
            <div className="thumbs" style={{ marginTop: 8 }}>
              {media.map((m) => <img key={m.id} src={m.publicUrl} alt="" />)}
            </div>
          )}
          {mediaIssues.length > 0 && (
            <div className="alert warn" style={{ marginTop: 8 }}>{mediaIssues.map((i) => i.message).join(" ")}</div>
          )}
        </div>
        <div>
          <label htmlFor="when">Data e hora (no horário local de cada unidade)</label>
          <input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
          <small>Unidades em fusos diferentes publicam no mesmo horário local, cada uma no seu fuso.</small>
        </div>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div>
          <button className="btn primary" disabled={busy || !when || selected.size === 0} onClick={submit}>
            {busy ? "Agendando..." : `Agendar em ${selected.size} conta${selected.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Unidades e contas</strong>
          <button className="btn small" onClick={selectAll}>{selected.size === allAccountIds.length ? "Limpar" : "Selecionar todas"}</button>
        </div>
        <div className="row">
          {platformsAvailable.map((p) => (
            <button key={p} className="btn small" onClick={() => togglePlatform(p)}>Todas: {PLATFORM_LABELS[p]}</button>
          ))}
        </div>
        {units.length === 0 && <small>Cadastre unidades e conecte contas em “Unidades e contas”.</small>}
        {units.map((u) => (
          <div className="unit-pick" key={u.id}>
            <header>
              <span>{u.name} <small>({u.timezone})</small></span>
              {u.accounts.length > 0 && <button className="btn small" onClick={() => toggleUnit(u)}>Toda a unidade</button>}
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
    </div>
  );
}

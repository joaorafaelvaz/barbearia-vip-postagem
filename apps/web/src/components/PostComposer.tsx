"use client";

import { validateMediaSet, type MediaKind } from "@fsp/core/media";
import { CAPTION_LIMITS, PLATFORM_LABELS, type Platform } from "@fsp/core/platforms";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AccountSelector, type ComposerUnit } from "./AccountSelector";
import { MediaPicker, type Uploaded } from "./MediaPicker";

export type { ComposerUnit } from "./AccountSelector";

export function PostComposer({ units }: { units: ComposerUnit[] }) {
  const router = useRouter();
  const [caption, setCaption] = useState("");
  const [when, setWhen] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [media, setMedia] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPlatforms = useMemo(() => {
    const set = new Set<Platform>();
    for (const u of units) for (const a of u.accounts) if (selected.has(a.id)) set.add(a.platform);
    return [...set];
  }, [units, selected]);
  const captionLen = [...caption].length;
  const mediaIssues = media.flatMap((m) => m.issues.filter((i) => selectedPlatforms.includes(i.platform)));
  const setIssues = validateMediaSet(media.map((m) => m.kind as MediaKind), selectedPlatforms);
  const warnings = [...new Set([...setIssues, ...mediaIssues].map((i) => i.message))];
  const blocked = setIssues.length > 0;

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

        <MediaPicker
          media={media}
          uploading={uploading}
          onUploadingChange={setUploading}
          onAdd={(m) => setMedia((list) => [...list, m])}
          onRemove={(id) => setMedia((list) => list.filter((x) => x.id !== id))}
          onError={setError}
        />
        {warnings.length > 0 && <div className={`alert ${blocked ? "error" : "warn"}`}>{warnings.join(" ")}</div>}

        <div>
          <label htmlFor="when">Data e hora (no horário local de cada unidade)</label>
          <input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
          <small>Unidades em fusos diferentes publicam no mesmo horário local, cada uma no seu fuso.</small>
        </div>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div>
          <button className="btn primary" disabled={busy || uploading || blocked || !when || selected.size === 0} onClick={submit}>
            {busy ? "Agendando..." : `Agendar em ${selected.size} conta${selected.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>

      <AccountSelector units={units} selected={selected} onChange={setSelected} />
    </div>
  );
}

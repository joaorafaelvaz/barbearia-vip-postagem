"use client";

import { validateMediaSet, type MediaKind } from "@fsp/core/media";
import { validateFormat, type PostFormat } from "@fsp/core/platforms";
import { CAPTION_LIMITS, PLATFORM_LABELS, type Platform } from "@fsp/core/platforms";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AccountSelector, type ComposerUnit } from "./AccountSelector";
import { FormatPicker } from "./FormatPicker";
import { IconAlert, IconCheck, IconInfo } from "./Icons";
import { MediaPicker, type Uploaded } from "./MediaPicker";

export type { ComposerUnit } from "./AccountSelector";

function minLocal(): string {
  const d = new Date(Date.now() + 5 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PostComposer({ units }: { units: ComposerUnit[] }) {
  const router = useRouter();
  const [format, setFormat] = useState<PostFormat>("FEED");
  const [caption, setCaption] = useState("");
  const [when, setWhen] = useState("");
  const [whenTouched, setWhenTouched] = useState(false);
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
  const overLimit = selectedPlatforms.filter((p) => captionLen > CAPTION_LIMITS[p]);
  const mediaIssues = media.flatMap((m) => m.issues.filter((i) => selectedPlatforms.includes(i.platform)));
  const kinds = media.map((m) => m.kind as MediaKind);
  const setIssues = [...(format === "FEED" ? validateMediaSet(kinds, selectedPlatforms) : []), ...validateFormat(format, selectedPlatforms, media.map((m) => ({ kind: m.kind, durationSec: m.durationSec, bytes: m.bytes })))];
  const warnings = [...new Set([...setIssues, ...mediaIssues].map((i) => i.message))];
  const needsMedia = (selectedPlatforms.includes("INSTAGRAM") || format !== "FEED") && media.length === 0;
  const whenInPast = when !== "" && new Date(when).getTime() < Date.now();
  const whenError = whenTouched && (when === "" ? "Escolha a data e a hora." : whenInPast ? "Esse horário já passou." : null);

  const blocker =
    selected.size === 0 ? "Selecione pelo menos uma conta."
    : !when ? "Escolha a data e a hora."
    : whenInPast ? "O horário escolhido já passou."
    : needsMedia ? (format === "FEED" ? "O Instagram exige uma imagem ou vídeo." : `${format === "REEL" ? "Reel exige um vídeo" : "Story exige uma imagem ou um vídeo"}.`)
    : setIssues.length > 0 ? "Ajuste as mídias ou as contas selecionadas."
    : overLimit.length > 0 ? `Texto acima do limite do ${overLimit.map((p) => PLATFORM_LABELS[p]).join(", ")}.`
    : caption.trim() === "" && media.length === 0 ? "Escreva um texto ou anexe uma mídia."
    : uploading ? "Aguarde o envio das mídias."
    : null;

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format, caption, scheduledLocal: when, mediaIds: media.map((m) => m.id), accountIds: [...selected] }),
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
    <div className="grid composer">
      <div className="card stack lg">
        <section className="section">
          <h2 className="section-title"><span className="num">1</span> Conteúdo</h2>
          <FormatPicker value={format} onChange={setFormat} />
          <div className="field">
            <label htmlFor="caption">{format === "STORY" ? "Texto (não é enviado em Stories; fica só como registro)" : "Texto da postagem"}</label>
            <textarea id="caption" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Escreva a legenda que será publicada em todas as contas selecionadas" aria-describedby="caption-hint" aria-invalid={overLimit.length > 0 || undefined} />
            <small id="caption-hint" className="hint">
              {captionLen} caracteres
              {selectedPlatforms.map((p) => (
                <span key={p} style={{ marginLeft: 10, color: captionLen > CAPTION_LIMITS[p] ? "var(--err)" : undefined }}>
                  {PLATFORM_LABELS[p]}: máx. {CAPTION_LIMITS[p].toLocaleString("pt-BR")}
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
          {warnings.length > 0 && (
            <div className={`alert ${setIssues.length > 0 ? "error" : "warn"}`} role="status">
              <IconAlert size="sm" /><span>{warnings.join(" ")}</span>
            </div>
          )}
        </section>

        <hr className="divider" />

        <section className="section">
          <h2 className="section-title"><span className="num">2</span> Quando publicar</h2>
          <div className="field">
            <label htmlFor="when">Data e hora (no horário local de cada unidade)</label>
            <input id="when" type="datetime-local" value={when} min={minLocal()} onChange={(e) => setWhen(e.target.value)} onBlur={() => setWhenTouched(true)} aria-invalid={Boolean(whenError) || undefined} aria-describedby="when-hint" required style={{ maxWidth: 280 }} />
            {whenError ? <span className="field-error"><IconAlert size="sm" />{whenError}</span> : null}
            <small id="when-hint" className="hint">Unidades em fusos diferentes publicam no mesmo horário local, cada uma no seu fuso.</small>
          </div>
        </section>

        {error && <div className="alert error" role="alert"><IconAlert size="sm" /><span>{error}</span></div>}

        <div className="action-bar">
          <span className="why" aria-live="polite">
            {blocker ? <><IconInfo size="sm" style={{ verticalAlign: "-3px", marginRight: 4 }} />{blocker}</> : <><IconCheck size="sm" style={{ verticalAlign: "-3px", marginRight: 4, color: "var(--ok)" }} />Pronto para agendar em {selected.size} conta{selected.size === 1 ? "" : "s"}.</>}
          </span>
          <button className="btn primary" disabled={busy || Boolean(blocker)} onClick={submit}>
            {busy ? <><span className="spinner" aria-hidden="true" /> Agendando...</> : `Agendar em ${selected.size} conta${selected.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>

      <AccountSelector units={units} selected={selected} onChange={setSelected} step={3} />
    </div>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconImage, IconUpload, IconX } from "./Icons";
import type { Uploaded } from "./MediaPicker";

export interface ReelCover {
  mediaId?: string;
  url?: string;
  offsetMs?: number;
}

interface Props {
  video: Uploaded;
  value: ReelCover;
  onChange: (next: ReelCover) => void;
  onError: (msg: string | null) => void;
}

async function uploadCover(blob: Blob, name: string): Promise<{ id: string; publicUrl: string }> {
  const fd = new FormData();
  fd.append("file", blob, name);
  const res = await fetch("/api/media", { method: "POST", body: fd });
  const body = (await res.json().catch(() => ({}))) as { id?: string; publicUrl?: string; error?: string };
  if (!res.ok || !body.id || !body.publicUrl) throw new Error(body.error ?? "Falha ao enviar a capa.");
  return { id: body.id, publicUrl: body.publicUrl };
}

/**
 * Capa do Reel: um quadro do vídeo (slider) ou uma imagem JPG. O quadro vira JPEG enviado
 * como mídia (Instagram usa cover_url; Facebook recebe via /thumbnails); o instante fica
 * guardado como reserva (thumb_offset).
 */
export function ReelCoverPicker({ video, value, onChange, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileId = useId();
  const [offsetSec, setOffsetSec] = useState(0);
  const [busy, setBusy] = useState(false);
  const duration = Math.max(0, video.durationSec ?? 0);

  useEffect(() => {
    const v = videoRef.current;
    if (v && Number.isFinite(offsetSec)) v.currentTime = offsetSec;
  }, [offsetSec]);

  async function useFrame() {
    const v = videoRef.current;
    if (!v) return;
    setBusy(true);
    onError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth || 1080;
      canvas.height = v.videoHeight || 1920;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Navegador sem suporte a canvas.");
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
      if (!blob) throw new Error("Não foi possível capturar o quadro.");
      const up = await uploadCover(blob, `capa-${Math.round(offsetSec * 1000)}.jpg`);
      onChange({ mediaId: up.id, url: up.publicUrl, offsetMs: Math.round(offsetSec * 1000) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/tainted|SecurityError|insecure/i.test(msg)) {
        // Vídeo em outro domínio sem CORS: guarda só o instante (vale para o Instagram).
        onChange({ offsetMs: Math.round(offsetSec * 1000) });
        onError("Não foi possível gerar a imagem da capa; o Instagram usará o instante escolhido e o Facebook, o quadro padrão.");
      } else {
        onError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function onFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (file.type !== "image/jpeg") {
      onError("A capa precisa ser JPG (exigência do Instagram).");
      return;
    }
    setBusy(true);
    onError(null);
    try {
      const up = await uploadCover(file, file.name);
      onChange({ mediaId: up.id, url: up.publicUrl });
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const hasCover = Boolean(value.mediaId) || value.offsetMs !== undefined;
  return (
    <div className="field cover-picker">
      <label>Capa do Reel</label>
      <div className="cover-picker-body">
        <video ref={videoRef} src={video.publicUrl} muted playsInline preload="auto" crossOrigin="anonymous" aria-label="Quadro do vídeo" />
        <div className="stack" style={{ gap: 8, minWidth: 0 }}>
          <label htmlFor={`${fileId}-range`} className="hint" style={{ margin: 0 }}>Quadro em {offsetSec.toFixed(1)}s de {duration.toFixed(0)}s</label>
          <input id={`${fileId}-range`} type="range" min={0} max={Math.max(0.1, duration)} step={0.1} value={offsetSec} onChange={(e) => setOffsetSec(Number(e.target.value))} disabled={busy || duration === 0} />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={useFrame} disabled={busy}><IconImage size="sm" /> Usar este quadro</button>
            <label className="btn" htmlFor={fileId} style={{ cursor: "pointer" }}><IconUpload size="sm" /> Enviar imagem JPG</label>
            <input id={fileId} type="file" accept="image/jpeg" style={{ display: "none" }} onChange={(e) => onFile(e.target.files)} disabled={busy} />
            {hasCover && <button type="button" className="btn ghost" onClick={() => onChange({})} disabled={busy}><IconX size="sm" /> Remover capa</button>}
          </div>
          {value.url ? (
            <div className="thumb"><img src={value.url} alt="Capa escolhida" /><span className="meta">Capa</span></div>
          ) : value.offsetMs !== undefined ? (
            <small className="hint">Capa: quadro em {(value.offsetMs / 1000).toFixed(1)}s (só Instagram).</small>
          ) : (
            <small className="hint">Sem capa escolhida: as redes usam o primeiro quadro do vídeo.</small>
          )}
        </div>
      </div>
    </div>
  );
}

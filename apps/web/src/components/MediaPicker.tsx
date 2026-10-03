"use client";

import type { Platform } from "@fsp/core/platforms";
import { useId } from "react";
import { IconUpload, IconVideo, IconX } from "./Icons";

export interface Uploaded {
  id: string;
  kind: "IMAGE" | "VIDEO";
  publicUrl: string;
  durationSec: number | null;
  issues: Array<{ platform: Platform; message: string }>;
}

const ACCEPT = "image/jpeg,image/png,image/gif,video/mp4,video/quicktime";

/** Lê dimensões e duração de um vídeo no navegador (o servidor não decodifica vídeo). */
function readVideoMeta(file: File): Promise<{ width: number; height: number; durationSec: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      resolve({ width: v.videoWidth, height: v.videoHeight, durationSec: v.duration });
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      resolve({ width: 0, height: 0, durationSec: 0 });
      URL.revokeObjectURL(url);
    };
    v.src = url;
  });
}

interface Props {
  media: Uploaded[];
  uploading: boolean;
  onUploadingChange: (v: boolean) => void;
  onAdd: (m: Uploaded) => void;
  onRemove: (id: string) => void;
  onError: (msg: string | null) => void;
}

export function MediaPicker({ media, uploading, onUploadingChange, onAdd, onRemove, onError }: Props) {
  const inputId = useId();

  async function onFiles(files: FileList | null) {
    if (!files) return;
    onUploadingChange(true);
    onError(null);
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      if (file.type.startsWith("video/")) {
        const meta = await readVideoMeta(file);
        fd.append("width", String(meta.width));
        fd.append("height", String(meta.height));
        fd.append("duration", String(meta.durationSec));
      }
      const res = await fetch("/api/media", { method: "POST", body: fd });
      const body = (await res.json()) as Uploaded & { error?: string };
      if (!res.ok) {
        onError(body.error ?? "Falha no upload");
        continue;
      }
      onAdd(body);
    }
    onUploadingChange(false);
  }

  return (
    <div className="field">
      <label htmlFor={inputId}>Imagens ou vídeo</label>
      <label className="dropzone" htmlFor={inputId} style={{ position: "relative", fontWeight: 400, marginBottom: 0 }}>
        <input id={inputId} type="file" accept={ACCEPT} multiple onChange={(e) => onFiles(e.target.files)} disabled={uploading} />
        {uploading ? <span className="spinner" aria-hidden="true" style={{ width: 24, height: 24, border: "2px solid var(--accent)", borderRightColor: "transparent", borderRadius: "50%", animation: "spin .8s linear infinite" }} /> : <IconUpload />}
        <span>
          <strong style={{ display: "block", color: "var(--text)" }}>{uploading ? "Enviando..." : "Clique para escolher arquivos"}</strong>
          <small>JPG, PNG ou GIF para imagens (o Instagram só aceita JPG). MP4 ou MOV para vídeo: um por postagem, sem misturar com imagens. O Google Meu Negócio não aceita vídeo.</small>
        </span>
      </label>
      {media.length > 0 && (
        <ul className="thumbs" style={{ listStyle: "none", padding: 0, margin: "var(--space-3) 0 0" }} aria-label="Mídias anexadas">
          {media.map((m, i) => (
            <li key={m.id} className="thumb">
              {m.kind === "VIDEO" ? <video src={m.publicUrl} muted playsInline /> : <img src={m.publicUrl} alt={`Mídia ${i + 1}`} />}
              {m.kind === "VIDEO" && <span className="meta"><IconVideo size="sm" style={{ width: 12, height: 12 }} />{m.durationSec !== null ? `${m.durationSec}s` : "vídeo"}</span>}
              <button type="button" className="btn remove" onClick={() => onRemove(m.id)} aria-label={`Remover mídia ${i + 1}`}><IconX size="sm" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

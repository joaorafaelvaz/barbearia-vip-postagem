"use client";

import type { Platform } from "@fsp/core/platforms";

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

  const thumb = { width: 84, height: 84, objectFit: "cover" as const, borderRadius: 8, border: "1px solid var(--border)" };

  return (
    <div>
      <label htmlFor="media">Imagens ou vídeo</label>
      <input id="media" type="file" accept={ACCEPT} multiple onChange={(e) => onFiles(e.target.files)} disabled={uploading} />
      <small>
        Imagens JPG/PNG (Instagram exige JPG). Vídeo MP4/MOV: um por postagem, publicado como Reels no Instagram e como vídeo na Page do Facebook.
        O Google Meu Negócio não aceita vídeo em postagens.
      </small>
      {uploading && <small style={{ display: "block" }}>Enviando...</small>}
      {media.length > 0 && (
        <div className="thumbs" style={{ marginTop: 8 }}>
          {media.map((m) => (
            <div key={m.id} style={{ position: "relative" }}>
              {m.kind === "VIDEO" ? <video src={m.publicUrl} muted playsInline style={thumb} /> : <img src={m.publicUrl} alt="" />}
              <button type="button" className="btn small" style={{ position: "absolute", top: 2, right: 2, padding: "0 6px" }} onClick={() => onRemove(m.id)} aria-label="Remover mídia">
                ×
              </button>
              {m.kind === "VIDEO" && m.durationSec !== null && <small style={{ display: "block", textAlign: "center" }}>{m.durationSec}s</small>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

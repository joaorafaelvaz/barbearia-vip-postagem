"use client";

import type { Platform } from "@fsp/core/platforms";
import { useId, useState } from "react";
import { IconUpload, IconVideo, IconX } from "./Icons";

export interface Uploaded {
  id: string;
  kind: "IMAGE" | "VIDEO";
  publicUrl: string;
  durationSec: number | null;
  bytes: number;
  width: number;
  height: number;
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

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

interface UploadOutcome {
  status: number;
  body: (Uploaded & { error?: string }) | null;
}

/** Envia com XMLHttpRequest para reportar progresso; respostas sem JSON (ex.: 413 do nginx) viram body null. */
function uploadWithProgress(fd: FormData, onProgress: (pct: number) => void): Promise<UploadOutcome> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      let body: UploadOutcome["body"] = null;
      try {
        body = JSON.parse(xhr.responseText) as UploadOutcome["body"];
      } catch {
        body = null;
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.onabort = () => reject(new Error("abort"));
    xhr.send(fd);
  });
}

function describeFailure(status: number, body: UploadOutcome["body"], file: File): string {
  if (body?.error) return body.error;
  if (status === 413) return `${file.name}: arquivo acima do limite do servidor (${mb(MAX_VIDEO_BYTES)}).`;
  if (status === 401) return "Sessão expirada. Entre novamente.";
  if (status >= 500) return `${file.name}: falha no servidor ao receber o arquivo (HTTP ${status}).`;
  return `${file.name}: falha no upload (HTTP ${status}).`;
}

function precheck(file: File): string | null {
  const isVideo = file.type.startsWith("video/");
  if (isVideo && file.size > MAX_VIDEO_BYTES) {
    return `${file.name} tem ${mb(file.size)}; o limite para vídeo é ${mb(MAX_VIDEO_BYTES)}. Comprima ou exporte em resolução menor.`;
  }
  if (!isVideo && file.size > MAX_IMAGE_BYTES) {
    return `${file.name} tem ${mb(file.size)}; o limite para imagem é ${mb(MAX_IMAGE_BYTES)}.`;
  }
  return null;
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
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files) return;
    onUploadingChange(true);
    onError(null);
    const errors: string[] = [];
    try {
      for (const file of Array.from(files)) {
        const pre = precheck(file);
        if (pre) {
          errors.push(pre);
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        if (file.type.startsWith("video/")) {
          const meta = await readVideoMeta(file);
          fd.append("width", String(meta.width));
          fd.append("height", String(meta.height));
          fd.append("duration", String(meta.durationSec));
        }
        setProgress({ name: file.name, pct: 0 });
        let outcome: UploadOutcome;
        try {
          outcome = await uploadWithProgress(fd, (pct) => setProgress({ name: file.name, pct }));
        } catch {
          errors.push(`${file.name}: conexão interrompida durante o envio.`);
          continue;
        }
        if (outcome.status < 200 || outcome.status >= 300 || !outcome.body) {
          errors.push(describeFailure(outcome.status, outcome.body, file));
          continue;
        }
        onAdd(outcome.body);
      }
    } finally {
      setProgress(null);
      onUploadingChange(false);
    }
    if (errors.length > 0) onError(errors.join(" "));
  }

  return (
    <div className="field">
      <label htmlFor={inputId}>Imagens ou vídeo</label>
      <label className="dropzone" htmlFor={inputId} style={{ position: "relative", fontWeight: 400, marginBottom: 0 }}>
        <input id={inputId} type="file" accept={ACCEPT} multiple onChange={(e) => onFiles(e.target.files)} disabled={uploading} />
        {uploading ? <span className="spinner" aria-hidden="true" style={{ width: 24, height: 24, border: "2px solid var(--accent)", borderRightColor: "transparent", borderRadius: "50%", animation: "spin .8s linear infinite" }} /> : <IconUpload />}
        <span>
          <strong style={{ display: "block", color: "var(--text)" }}>{uploading ? (progress ? `Enviando ${progress.name}... ${progress.pct}%` : "Enviando...") : "Clique para escolher arquivos"}</strong>
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

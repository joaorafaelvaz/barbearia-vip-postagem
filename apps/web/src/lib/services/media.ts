import { IMAGE_MIME_TYPES, PLATFORMS, VIDEO_MIME_TYPES, validateMedia, type MediaIssue, type MediaKind } from "@fsp/core";
import type { PrismaClient } from "@fsp/db";
import { imageSize } from "image-size";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../api";
import { appUrl, optionalEnv } from "../env";

export interface StoredFile {
  storageKey: string;
  publicUrl: string;
}

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<StoredFile>;
}

/** Armazenamento local em `public/uploads` para desenvolvimento (sem S3 configurado). */
export function localStorage(root = optionalEnv("UPLOADS_DIR") ?? path.join(process.cwd(), "public", "uploads")): Storage {
  return {
    async put(key, body) {
      const file = path.join(root, key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
      return { storageKey: key, publicUrl: `${appUrl()}/uploads/${key}` };
    },
  };
}

/** S3 compatível (AWS S3, Cloudflare R2, MinIO). Carregado só quando configurado. */
export async function s3Storage(): Promise<Storage> {
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const bucket = optionalEnv("S3_BUCKET");
  const publicBase = optionalEnv("S3_PUBLIC_BASE_URL");
  if (!bucket || !publicBase) throw new Error("S3_BUCKET e S3_PUBLIC_BASE_URL são obrigatórios para S3.");
  const endpoint = optionalEnv("S3_ENDPOINT");
  const client = new S3Client({
    region: optionalEnv("S3_REGION") ?? "auto",
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: optionalEnv("S3_ACCESS_KEY_ID") ?? "",
      secretAccessKey: optionalEnv("S3_SECRET_ACCESS_KEY") ?? "",
    },
  });
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
      return { storageKey: key, publicUrl: `${publicBase.replace(/\/$/, "")}/${key}` };
    },
  };
}

export async function getStorage(): Promise<Storage> {
  return optionalEnv("S3_BUCKET") ? s3Storage() : localStorage();
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

export interface UploadResult {
  id: string;
  kind: MediaKind;
  publicUrl: string;
  width: number;
  height: number;
  durationSec: number | null;
  mimeType: string;
  bytes: number;
  /** Avisos por plataforma: a mídia pode não servir para todas. */
  issues: MediaIssue[];
}

export interface UploadFile {
  name: string;
  type: string;
  bytes: Buffer;
  /** Metadados de vídeo lidos no navegador (o servidor não decodifica vídeo). */
  videoMeta?: { width: number; height: number; durationSec: number };
}

export async function uploadMedia(
  deps: { prisma: PrismaClient; storage: Storage },
  organizationId: string,
  file: UploadFile,
): Promise<UploadResult> {
  const ext = EXT[file.type];
  if (!ext) throw new HttpError(400, "Formato não suportado. Use JPG, PNG, GIF, MP4 ou MOV.");
  const isVideo = (VIDEO_MIME_TYPES as readonly string[]).includes(file.type);
  const isImage = (IMAGE_MIME_TYPES as readonly string[]).includes(file.type);
  if (!isVideo && !isImage) throw new HttpError(400, "Formato não suportado.");

  let width = 0;
  let height = 0;
  let durationSec: number | null = null;
  const kind: MediaKind = isVideo ? "VIDEO" : "IMAGE";

  if (isVideo) {
    if (file.bytes.length > MAX_VIDEO_BYTES) throw new HttpError(400, `Vídeo acima de ${MAX_VIDEO_BYTES / 1024 / 1024}MB.`);
    width = file.videoMeta?.width ?? 0;
    height = file.videoMeta?.height ?? 0;
    durationSec = file.videoMeta ? Math.round(file.videoMeta.durationSec) : null;
  } else {
    if (file.bytes.length > MAX_IMAGE_BYTES) throw new HttpError(400, "Imagem acima de 10MB.");
    let dims: { width?: number; height?: number };
    try {
      dims = imageSize(file.bytes);
    } catch {
      throw new HttpError(400, "Arquivo de imagem inválido.");
    }
    if (!dims.width || !dims.height) throw new HttpError(400, "Não foi possível ler as dimensões da imagem.");
    width = dims.width;
    height = dims.height;
  }

  const key = `${organizationId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  let stored: StoredFile;
  try {
    stored = await deps.storage.put(key, file.bytes, file.type);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code ?? "";
    console.error("[media] falha ao gravar arquivo", { key, bytes: file.bytes.length, code }, err);
    throw new HttpError(500, `Falha ao gravar o arquivo no servidor${code ? ` (${code})` : ""}. Verifique a pasta de uploads.`);
  }
  const asset = await deps.prisma.mediaAsset.create({
    data: {
      organizationId,
      kind,
      storageKey: stored.storageKey,
      publicUrl: stored.publicUrl,
      mimeType: file.type,
      width,
      height,
      bytes: file.bytes.length,
      durationSec,
    },
  });
  const issues = validateMedia(
    { kind, mimeType: file.type, width, height, bytes: file.bytes.length, ...(durationSec !== null ? { durationSec } : {}) },
    PLATFORMS,
  );
  return { id: asset.id, kind, publicUrl: asset.publicUrl, width, height, durationSec, mimeType: file.type, bytes: file.bytes.length, issues };
}

/** Compatibilidade com o nome anterior. */
export const uploadImage = uploadMedia;

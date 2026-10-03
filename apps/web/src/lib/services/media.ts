import { validateImage, PLATFORMS, type MediaIssue } from "@fsp/core";
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
export function localStorage(root = path.join(process.cwd(), "public", "uploads")): Storage {
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

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif" };

export interface UploadResult {
  id: string;
  publicUrl: string;
  width: number;
  height: number;
  mimeType: string;
  bytes: number;
  /** Avisos por plataforma: a imagem pode não servir para todas. */
  issues: MediaIssue[];
}

export async function uploadImage(
  deps: { prisma: PrismaClient; storage: Storage },
  organizationId: string,
  file: { name: string; type: string; bytes: Buffer },
): Promise<UploadResult> {
  const ext = EXT[file.type];
  if (!ext) throw new HttpError(400, "Formato não suportado. Use JPG, PNG ou GIF.");
  if (file.bytes.length > 10 * 1024 * 1024) throw new HttpError(400, "Imagem acima de 10MB.");

  let dims: { width?: number; height?: number };
  try {
    dims = imageSize(file.bytes);
  } catch {
    throw new HttpError(400, "Arquivo de imagem inválido.");
  }
  if (!dims.width || !dims.height) throw new HttpError(400, "Não foi possível ler as dimensões da imagem.");

  const key = `${organizationId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  const stored = await deps.storage.put(key, file.bytes, file.type);
  const asset = await deps.prisma.mediaAsset.create({
    data: {
      organizationId,
      storageKey: stored.storageKey,
      publicUrl: stored.publicUrl,
      mimeType: file.type,
      width: dims.width,
      height: dims.height,
      bytes: file.bytes.length,
    },
  });
  const issues = validateImage({ mimeType: file.type, width: dims.width, height: dims.height, bytes: file.bytes.length }, PLATFORMS);
  return { id: asset.id, publicUrl: asset.publicUrl, width: dims.width, height: dims.height, mimeType: file.type, bytes: file.bytes.length, issues };
}

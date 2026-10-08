import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredFile {
  storageKey: string;
  publicUrl: string;
}

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<StoredFile>;
  /** Caminho local do arquivo, quando o armazenamento é em disco (evita baixar pela URL). */
  localPath?(key: string): string;
}

const appUrl = (): string => (process.env.AUTH_URL ?? "http://localhost:3022").replace(/\/$/, "");

/**
 * Pasta de uploads compartilhada com o web. Em produção o compose monta o mesmo volume
 * nos dois contêineres (UPLOADS_DIR); em dev o worker roda em apps/worker e usa apps/web/public/uploads.
 */
export function uploadsDir(): string {
  if (process.env.UPLOADS_DIR) return process.env.UPLOADS_DIR;
  const candidates = [
    path.resolve(process.cwd(), "../web/public/uploads"),
    path.resolve(process.cwd(), "apps/web/public/uploads"),
  ];
  return candidates.find((c) => existsSync(path.dirname(c))) ?? candidates[0]!;
}

export function localStorage(root = uploadsDir()): Storage {
  return {
    async put(key, body) {
      const file = path.join(root, key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
      return { storageKey: key, publicUrl: `${appUrl()}/uploads/${key}` };
    },
    localPath: (key) => path.join(root, key),
  };
}

/** S3 compatível, espelho do web (apps/web/src/lib/services/media.ts). */
export async function s3Storage(): Promise<Storage> {
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const bucket = process.env.S3_BUCKET;
  const publicBase = process.env.S3_PUBLIC_BASE_URL;
  if (!bucket || !publicBase) throw new Error("S3_BUCKET e S3_PUBLIC_BASE_URL são obrigatórios para S3.");
  const endpoint = process.env.S3_ENDPOINT;
  const client = new S3Client({
    region: process.env.S3_REGION ?? "auto",
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
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
  return process.env.S3_BUCKET ? s3Storage() : localStorage();
}

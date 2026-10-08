import { NextResponse } from "next/server";
import { HttpError, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getStorage, MAX_VIDEO_BYTES, uploadMedia } from "@/lib/services/media";
import { requireSession } from "@/lib/session";

/**
 * Upload multipart: campo `file` (imagem ou vídeo). Para vídeo, o navegador envia
 * `width`, `height` e `duration` (segundos) lidos do elemento <video>.
 */
export const POST = route(async (req: Request) => {
  const s = await requireSession();
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_VIDEO_BYTES + 1024 * 1024) {
    throw new HttpError(413, `Arquivo acima do limite de ${MAX_VIDEO_BYTES / 1024 / 1024}MB.`);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    console.error("[media] falha ao ler multipart", { declared }, err);
    throw new HttpError(400, "Não foi possível ler o arquivo enviado. Tente novamente.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Envie o arquivo no campo 'file'.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const num = (k: string) => {
    const v = Number(form.get(k));
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const videoMeta = file.type.startsWith("video/")
    ? { width: num("width"), height: num("height"), durationSec: num("duration") }
    : undefined;
  const result = await uploadMedia({ prisma, storage: await getStorage() }, s.organizationId, {
    name: file.name,
    type: file.type,
    bytes,
    ...(videoMeta ? { videoMeta } : {}),
  });
  return NextResponse.json(result, { status: 201 });
});

import { NextResponse } from "next/server";
import { HttpError, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getStorage, uploadImage } from "@/lib/services/media";
import { requireSession } from "@/lib/session";

/** Upload multipart: campo `file`. Retorna o asset e avisos por plataforma. */
export const POST = route(async (req: Request) => {
  const s = await requireSession();
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Envie o arquivo no campo 'file'.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await uploadImage({ prisma, storage: await getStorage() }, s.organizationId, {
    name: file.name,
    type: file.type,
    bytes,
  });
  return NextResponse.json(result, { status: 201 });
});

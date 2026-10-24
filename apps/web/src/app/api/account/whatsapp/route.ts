import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { chatIdSchema } from "@/lib/services/whatsapp-notices";
import { requireSession } from "@/lib/session";

/** Número do próprio usuário para "Enviar teste para mim". Qualquer usuário autenticado, só o próprio registro. */
export const PATCH = route(async (req: Request) => {
  const s = await requireSession();
  const input = z.object({ whatsappChatId: chatIdSchema }).parse(await req.json());
  await prisma.user.update({ where: { id: s.userId }, data: { whatsappChatId: input.whatsappChatId || null } });
  return NextResponse.json({ ok: true });
});

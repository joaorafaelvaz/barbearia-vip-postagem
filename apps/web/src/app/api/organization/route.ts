import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { chatIdSchema } from "@/lib/services/whatsapp-notices";
import { requireSession } from "@/lib/session";

const patchSchema = z.object({ whatsappChatId: chatIdSchema });

/** Grupo WhatsApp da franqueadora (destino "Franqueadora" dos avisos). Só administrador. */
export const PATCH = route(async (req: Request) => {
  const s = await requireSession();
  requireAdmin(s);
  const input = patchSchema.parse(await req.json());
  await prisma.organization.update({ where: { id: s.organizationId }, data: { whatsappChatId: input.whatsappChatId || null } });
  return NextResponse.json({ ok: true });
});

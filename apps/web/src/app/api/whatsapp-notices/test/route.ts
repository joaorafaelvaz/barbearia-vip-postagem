import { WahaClient } from "@fsp/connectors";
import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { sendTestNotice } from "@/lib/services/whatsapp-notices";
import { requireSession } from "@/lib/session";

/** "Enviar teste para mim": envio imediato para o User.whatsappChatId do próprio administrador. */
export const POST = route(async (req: Request) => {
  const s = await requireSession();
  requireAdmin(s);
  await sendTestNotice(prisma, WahaClient.fromEnv(), s.userId, await req.json());
  return NextResponse.json({ ok: true });
});

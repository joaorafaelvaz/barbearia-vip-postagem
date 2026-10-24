import { NextResponse } from "next/server";
import { route } from "@/lib/api";
import { requireAdmin } from "@/lib/authz";
import { optionalEnv } from "@/lib/env";
import { generateNoticeText } from "@/lib/services/whatsapp-ai";
import { requireSession } from "@/lib/session";

/** "Gerar com IA": devolve só o texto; agendar continua sendo uma ação explícita do administrador. */
export const POST = route(async (req: Request) => {
  const s = await requireSession();
  requireAdmin(s);
  const text = await generateNoticeText({ apiKey: optionalEnv("ANTHROPIC_API_KEY") }, await req.json());
  return NextResponse.json({ text });
});

import { isValidTimeZone } from "@fsp/core";
import { NextResponse } from "next/server";
import { z } from "zod";
import { HttpError, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { listUnitsWithAccounts } from "@/lib/services/accounts";
import { requireSession } from "@/lib/session";

const unitSchema = z.object({
  name: z.string().min(2).max(120),
  city: z.string().max(120).optional(),
  timezone: z.string().default("America/Sao_Paulo"),
});

export const GET = route(async () => {
  const s = await requireSession();
  return NextResponse.json({ units: await listUnitsWithAccounts(prisma, s.organizationId) });
});

export const POST = route(async (req: Request) => {
  const s = await requireSession();
  const input = unitSchema.parse(await req.json());
  if (!isValidTimeZone(input.timezone)) throw new HttpError(400, "Fuso horário inválido.");
  const unit = await prisma.unit.create({
    data: { organizationId: s.organizationId, name: input.name, city: input.city ?? null, timezone: input.timezone },
  });
  return NextResponse.json({ unit }, { status: 201 });
});

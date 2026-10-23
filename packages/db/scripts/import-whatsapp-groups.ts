/**
 * Importa os grupos WhatsApp do daily (config/unit_groups.json) para Unit.whatsappChatId,
 * casando `units[*].nome` com Unit.name sem acentos/caixa. Uso:
 *   pnpm --filter @fsp/db import:whatsapp-groups -- <caminho/unit_groups.json> [--org <organizationId>] [--force]
 * Sem --force, unidades que já têm whatsappChatId são puladas. Nomes não casados são listados dos dois lados.
 */
import { normalizeUnitName } from "@fsp/core";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

interface DailyUnit { nome: string; chat_id?: string; chat_ids?: string[] }
interface DailyFile { units: Record<string, DailyUnit> }

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("informe o caminho do unit_groups.json");
  const orgArg = args.indexOf("--org");
  const organizationId = orgArg >= 0 ? args[orgArg + 1] : undefined;
  const force = args.includes("--force");

  const daily = JSON.parse(readFileSync(file, "utf8")) as DailyFile;
  const orgs = await prisma.organization.findMany({ where: organizationId ? { id: organizationId } : {}, select: { id: true, name: true } });
  if (orgs.length !== 1) throw new Error(`esperava 1 organização, achei ${orgs.length}; use --org <id>`);
  const org = orgs[0]!;
  const units = await prisma.unit.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, whatsappChatId: true } });
  const byKey = new Map(units.map((u) => [normalizeUnitName(u.name), u]));

  const matched: string[] = [], skipped: string[] = [], unmatched: string[] = [];
  const used = new Set<string>();
  for (const [erpId, du] of Object.entries(daily.units)) {
    // O Publicador guarda UM chat por unidade (decisão: todos os mapeamentos atuais são únicos).
    // O daily aceita chat_id + chat_ids (lista): se houver mais de um, usa o primeiro e AVISA.
    const chats = [du.chat_id, ...(du.chat_ids ?? [])].filter((c): c is string => Boolean(c));
    const chat = chats[0];
    if (chats.length > 1) console.warn(`AVISO: #${erpId} ${du.nome} tem ${chats.length} chats no daily (${chats.join(", ")}); só o primeiro é importado.`);
    const unit = byKey.get(normalizeUnitName(du.nome));
    if (!unit || !chat) { unmatched.push(`#${erpId} ${du.nome}${chat ? "" : " (sem chat_id)"}`); continue; }
    used.add(unit.id);
    if (unit.whatsappChatId && !force) { skipped.push(`${unit.name} (já tem ${unit.whatsappChatId})`); continue; }
    await prisma.unit.update({ where: { id: unit.id }, data: { whatsappChatId: chat } });
    matched.push(`${unit.name} <- ${chat}`);
  }
  const leftover = units.filter((u) => !used.has(u.id)).map((u) => u.name);
  console.log(`Organização: ${org.name}`);
  console.log(`\nPreenchidas (${matched.length}):\n  ${matched.join("\n  ") || "-"}`);
  console.log(`\nPuladas, já tinham chat (${skipped.length}):\n  ${skipped.join("\n  ") || "-"}`);
  console.log(`\nNÃO casadas no daily (${unmatched.length}):\n  ${unmatched.join("\n  ") || "-"}`);
  console.log(`\nUnidades do Publicador sem correspondente (${leftover.length}):\n  ${leftover.join("\n  ") || "-"}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

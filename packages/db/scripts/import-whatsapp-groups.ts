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
  const orgArg = args.indexOf("--org");
  let organizationId: string | undefined;
  if (orgArg >= 0) {
    organizationId = args[orgArg + 1];
    if (!organizationId || organizationId.startsWith("--")) throw new Error("--org exige o id da organização");
    args.splice(orgArg, 2); // tira a flag e o valor antes de procurar o caminho do arquivo
  }
  const force = args.includes("--force");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) throw new Error("informe o caminho do unit_groups.json");

  const daily = JSON.parse(readFileSync(file, "utf8")) as DailyFile;
  const orgs = await prisma.organization.findMany({
    where: organizationId ? { id: organizationId } : {},
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (orgs.length === 0) throw new Error(organizationId ? `organização ${organizationId} não encontrada` : "nenhuma organização cadastrada");
  if (orgs.length > 1) throw new Error(`há ${orgs.length} organizações; use --org <id>:\n  ${orgs.map((o) => `${o.id}  ${o.name}`).join("\n  ")}`);
  const org = orgs[0]!;
  if (!organizationId) console.log(`Única organização do banco, usada automaticamente: ${org.name} (${org.id})`);
  const units = await prisma.unit.findMany({ where: { organizationId: org.id }, select: { id: true, name: true, whatsappChatId: true } });
  // Nomes que colidem depois de normalizados são ambíguos: ficam de fora em vez de casar silenciosamente com o último.
  const byKey = new Map<string, (typeof units)[number]>();
  const ambiguous = new Set<string>();
  for (const u of units) {
    const key = normalizeUnitName(u.name);
    if (byKey.has(key)) ambiguous.add(key);
    else byKey.set(key, u);
  }

  const matched: string[] = [], skipped: string[] = [], unmatched: string[] = [];
  const used = new Set<string>();
  for (const [erpId, du] of Object.entries(daily.units)) {
    // O Publicador guarda UM chat por unidade (decisão: todos os mapeamentos atuais são únicos).
    // O daily aceita chat_id + chat_ids (lista): se houver mais de um, usa o primeiro e AVISA.
    const chats = [du.chat_id, ...(du.chat_ids ?? [])].filter((c): c is string => Boolean(c));
    const chat = chats[0];
    if (chats.length > 1) console.warn(`AVISO: #${erpId} ${du.nome} tem ${chats.length} chats no daily (${chats.join(", ")}); só o primeiro é importado.`);
    const key = normalizeUnitName(du.nome);
    const unit = ambiguous.has(key) ? undefined : byKey.get(key);
    if (!unit || !chat) {
      const why = !chat ? " (sem chat_id)" : ambiguous.has(key) ? " (nome ambíguo no Publicador)" : "";
      unmatched.push(`#${erpId} ${du.nome}${why}`);
      continue;
    }
    used.add(unit.id);
    if (unit.whatsappChatId && !force) { skipped.push(`${unit.name} (já tem ${unit.whatsappChatId})`); continue; }
    await prisma.unit.update({ where: { id: unit.id }, data: { whatsappChatId: chat } });
    unit.whatsappChatId = chat; // uma segunda entrada do daily para a mesma unidade não sobrescreve sem --force
    matched.push(`${unit.name} <- ${chat}`);
  }
  const leftover = units.filter((u) => !used.has(u.id)).map((u) => `${u.name}${ambiguous.has(normalizeUnitName(u.name)) ? " (nome ambíguo)" : ""}`);
  console.log(`Organização: ${org.name}`);
  console.log(`\nPreenchidas (${matched.length}):\n  ${matched.join("\n  ") || "-"}`);
  console.log(`\nPuladas, já tinham chat (${skipped.length}):\n  ${skipped.join("\n  ") || "-"}`);
  console.log(`\nNÃO casadas no daily (${unmatched.length}):\n  ${unmatched.join("\n  ") || "-"}`);
  console.log(`\nUnidades do Publicador sem correspondente (${leftover.length}):\n  ${leftover.join("\n  ") || "-"}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

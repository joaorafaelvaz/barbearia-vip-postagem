import type { Platform } from "@fsp/core";
import { PostComposer } from "@/components/PostComposer";
import { prisma } from "@/lib/db";
import { listUnitsWithAccounts } from "@/lib/services/accounts";
import { requireSession } from "@/lib/session";

export default async function NewPostPage() {
  const s = await requireSession();
  const units = await listUnitsWithAccounts(prisma, s.organizationId);
  return (
    <div className="stack">
      <h1>Nova postagem</h1>
      <p className="muted">Uma postagem, várias unidades. Escolha o texto, as imagens, o horário e em quais contas publicar.</p>
      <PostComposer
        units={units.map((u) => ({
          id: u.id,
          name: u.name,
          timezone: u.timezone,
          accounts: u.accounts.map((a) => ({ id: a.id, platform: a.platform as Platform, displayName: a.displayName })),
        }))}
      />
    </div>
  );
}

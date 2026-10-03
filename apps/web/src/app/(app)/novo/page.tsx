import type { Platform } from "@fsp/core";
import { PostComposer } from "@/components/PostComposer";
import { allowedUnitIds } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { listUnitsWithAccounts } from "@/lib/services/accounts";
import { requireSession } from "@/lib/session";

export default async function NewPostPage() {
  const s = await requireSession();
  const units = await listUnitsWithAccounts(prisma, s.organizationId, await allowedUnitIds(prisma, s));
  return (
    <div className="stack lg">
      <div className="page-head">
        <div>
          <h1>Nova postagem</h1>
          <p className="lead">Uma postagem, várias unidades. Monte o conteúdo, escolha o horário e marque em quais contas publicar.</p>
        </div>
      </div>
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

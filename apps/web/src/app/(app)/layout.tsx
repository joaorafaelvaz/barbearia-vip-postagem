import type { ReactNode } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { ROLE_LABELS, isAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const org = session
    ? await prisma.organization.findUnique({ where: { id: session.organizationId }, select: { name: true } })
    : null;
  return (
    <div className="shell">
      <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <AppSidebar
        orgName={org?.name ?? "Minha rede"}
        email={session?.email ?? ""}
        name={session?.name ?? null}
        roleLabel={session ? ROLE_LABELS[session.role] : ""}
        isAdmin={Boolean(session && isAdmin(session))}
      />
      <main className="main" id="conteudo">{children}</main>
    </div>
  );
}

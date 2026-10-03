import type { ReactNode } from "react";
import { IconDashboard, IconLogout, IconMegaphone, IconPlus, IconStore } from "@/components/Icons";
import { NavLink } from "@/components/NavLink";
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
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="brand">
          <span className="mark"><IconMegaphone /></span>
          <span>Publicador da Rede</span>
        </div>
        <nav className="stack" style={{ gap: 2 }}>
          <NavLink href="/" icon={<IconDashboard />}>Painel</NavLink>
          <NavLink href="/novo" icon={<IconPlus />}>Nova postagem</NavLink>
          <NavLink href="/unidades" icon={<IconStore />}>Unidades e contas</NavLink>
        </nav>
        <div className="spacer" />
        <div className="user">
          <strong>{org?.name ?? "Minha rede"}</strong>
          <span>{session?.email}</span>
        </div>
        <form action="/api/auth/logout" method="post">
          <button className="btn small" type="submit" style={{ width: "100%" }}>
            <IconLogout size="sm" /> Sair
          </button>
        </form>
      </aside>
      <main className="main" id="conteudo">{children}</main>
    </div>
  );
}

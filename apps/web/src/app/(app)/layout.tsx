import Link from "next/link";
import type { ReactNode } from "react";
import { getSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Publicador da Rede</div>
        <Link href="/">Painel</Link>
        <Link href="/novo">Nova postagem</Link>
        <Link href="/unidades">Unidades e contas</Link>
        <div className="spacer" />
        <div className="user">{session?.email}</div>
        <form action="/api/auth/logout" method="post">
          <button className="btn small" type="submit">Sair</button>
        </form>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

"use client";

import { useState } from "react";
import { IconChart, IconDashboard, IconLogout, IconMegaphone, IconPlus, IconStore, IconUser, IconUsers } from "./Icons";
import { ThemeToggle } from "./ThemeToggle";
import { Sidebar, SidebarBody, SidebarLink, type Links } from "./ui/sidebar";

export interface AppSidebarProps {
  orgName: string;
  email: string;
  name: string | null;
  roleLabel: string;
  isAdmin: boolean;
}

/** Barra lateral do app: navegação, tema, usuário e sair. Recolhível no desktop, hambúrguer no mobile. */
export function AppSidebar({ orgName, email, name, roleLabel, isAdmin }: AppSidebarProps) {
  const [open, setOpen] = useState(false);
  const links: Array<Links & { exact?: boolean }> = [
    { label: "Painel", href: "/", icon: <IconDashboard />, exact: true },
    { label: "Nova postagem", href: "/novo", icon: <IconPlus /> },
    { label: "Analytics", href: "/analytics", icon: <IconChart /> },
    { label: "Unidades e contas", href: "/unidades", icon: <IconStore /> },
    ...(isAdmin ? [{ label: "Usuários", href: "/usuarios", icon: <IconUsers /> }] : []),
    { label: "Minha conta", href: "/conta", icon: <IconUser /> },
  ];
  const initials = (name ?? email).split(/[\s@]+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

  return (
    <Sidebar open={open} setOpen={setOpen}>
      <SidebarBody>
        <div className="sb-brand">
          <span className="brand-name"><span className="mark"><IconMegaphone /></span><span>Publicador da Rede</span></span>
          <ThemeToggle />
        </div>
        <nav className="sb-nav" aria-label="Seções">
          {links.map(({ exact, ...link }) => <SidebarLink key={link.href} link={link} exact={exact ?? false} />)}
        </nav>
        <div className="sb-spacer" />
        <div className="sb-user" title={`${orgName} · ${email}`}>
          <span className="avatar" aria-hidden="true">{initials || "?"}</span>
          <span className="who">
            <strong>{orgName}</strong>
            <span>{email} · {roleLabel}</span>
          </span>
        </div>
        <div className="sb-footer">
          <form action="/api/auth/logout" method="post">
            <button className="btn small" type="submit" aria-label="Sair" title="Sair" style={{ width: "100%" }}>
              <IconLogout size="sm" /> <span className="btn-label">Sair</span>
            </button>
          </form>
        </div>
      </SidebarBody>
    </Sidebar>
  );
}

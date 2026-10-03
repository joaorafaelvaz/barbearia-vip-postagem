"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { IconMenu, IconX } from "../Icons";
import "./sidebar.css";

export interface Links {
  label: string;
  href: string;
  icon: ReactNode;
}

interface SidebarContextProps {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  animate: boolean;
}

const SidebarContext = createContext<SidebarContextProps | undefined>(undefined);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider");
  return context;
};

interface ProviderProps {
  children: ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  /** false = sempre expandida no desktop */
  animate?: boolean;
}

export const SidebarProvider = ({ children, open: openProp, setOpen: setOpenProp, animate = true }: ProviderProps) => {
  const [openState, setOpenState] = useState(false);
  const open = openProp !== undefined ? openProp : openState;
  const setOpen = setOpenProp !== undefined ? setOpenProp : setOpenState;
  return <SidebarContext.Provider value={{ open, setOpen, animate }}>{children}</SidebarContext.Provider>;
};

export const Sidebar = (props: ProviderProps) => <SidebarProvider {...props} />;

export const SidebarBody = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <>
    <DesktopSidebar className={className}>{children}</DesktopSidebar>
    <MobileSidebar className={className}>{children}</MobileSidebar>
  </>
);

/** Desktop: recolhida (só ícones) e expande ao passar o mouse ou receber foco de teclado. */
export const DesktopSidebar = ({ children, className = "" }: { children: ReactNode; className?: string }) => {
  const { open, setOpen, animate } = useSidebar();
  const expanded = !animate || open;
  return (
    <aside
      className={`ui-sidebar desktop ${expanded ? "open" : "closed"} ${className}`}
      aria-label="Navegação principal"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {children}
    </aside>
  );
};

/** Mobile: barra superior com hambúrguer; o menu abre em sobreposição de tela cheia. */
export const MobileSidebar = ({ children, className = "" }: { children: ReactNode; className?: string }) => {
  const { open, setOpen } = useSidebar();
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname, setOpen]); // fecha ao navegar
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, setOpen]);
  return (
    <div className={`ui-sidebar mobile ${className}`}>
      <div className="mobile-bar">
        <button type="button" className="btn small icon-only" aria-label="Abrir menu" aria-expanded={open} aria-controls="mobile-menu" onClick={() => setOpen(true)}>
          <IconMenu />
        </button>
      </div>
      <div id="mobile-menu" className={`mobile-overlay ${open ? "open" : ""}`} role="dialog" aria-modal="true" aria-label="Menu" aria-hidden={!open}>
        <button type="button" className="btn small icon-only close" aria-label="Fechar menu" onClick={() => setOpen(false)} tabIndex={open ? 0 : -1}>
          <IconX />
        </button>
        {children}
      </div>
    </div>
  );
};

export const SidebarLink = ({ link, className = "", exact = false }: { link: Links; className?: string; exact?: boolean }) => {
  const { open, animate } = useSidebar();
  const pathname = usePathname();
  const active = exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
  const showLabel = !animate || open;
  return (
    <Link href={link.href} className={`ui-sidebar-link ${active ? "active" : ""} ${className}`} aria-current={active ? "page" : undefined} aria-label={link.label} title={link.label}>
      {link.icon}
      <span className="label" aria-hidden={!showLabel}>{link.label}</span>
    </Link>
  );
};

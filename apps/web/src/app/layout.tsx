import type { Metadata } from "next";
import type { ReactNode } from "react";
import { THEME_INIT_SCRIPT } from "@/components/ThemeToggle";
import "./globals.css";

export const viewport = { themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f5f3ee" }, { media: "(prefers-color-scheme: dark)", color: "#15130f" }] };

export const metadata: Metadata = {
  title: "Publicador da Rede",
  description: "Agende e publique a mesma postagem em todas as unidades: Instagram, Facebook e Google Meu Negócio.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

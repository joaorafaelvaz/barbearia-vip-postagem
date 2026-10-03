import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import { THEME_INIT_SCRIPT } from "@/components/ThemeToggle";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const viewport = { themeColor: [{ media: "(prefers-color-scheme: light)", color: "#fbfcf8" }, { media: "(prefers-color-scheme: dark)", color: "#020617" }] };

export const metadata: Metadata = {
  title: "Publicador da Rede",
  description: "Agende e publique a mesma postagem em todas as unidades: Instagram, Facebook e Google Meu Negócio.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

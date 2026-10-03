import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { IconMegaphone } from "@/components/Icons";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function LoginPage() {
  return (
    <div className="auth">
      <div className="card stack">
        <div className="brand row between"><span className="row" style={{ gap: 10 }}><span className="mark"><IconMegaphone /></span> Publicador da Rede</span><ThemeToggle /></div>
        <h1 style={{ fontSize: "var(--fs-xl)" }}>Entrar</h1>
        <Suspense>
          <AuthForm mode="login" />
        </Suspense>
        <p className="muted">
          Primeira vez? <Link href="/registro">Criar a conta da rede</Link>
        </p>
      </div>
    </div>
  );
}

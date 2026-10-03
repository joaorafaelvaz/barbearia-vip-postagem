import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { IconMegaphone } from "@/components/Icons";

export default function LoginPage() {
  return (
    <div className="auth">
      <div className="card stack">
        <div className="brand"><span className="mark"><IconMegaphone /></span> Publicador da Rede</div>
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

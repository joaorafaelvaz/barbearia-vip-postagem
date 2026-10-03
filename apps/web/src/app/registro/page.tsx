import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";
import { IconMegaphone } from "@/components/Icons";

export default function RegisterPage() {
  return (
    <div className="auth">
      <div className="card stack">
        <div className="brand"><span className="mark"><IconMegaphone /></span> Publicador da Rede</div>
        <h1 style={{ fontSize: "var(--fs-xl)" }}>Criar conta da rede</h1>
        <p className="muted">Você será o administrador. Depois cadastre as unidades e conecte as contas de cada uma.</p>
        <Suspense>
          <AuthForm mode="register" />
        </Suspense>
        <p className="muted">
          Já tem conta? <Link href="/login">Entrar</Link>
        </p>
      </div>
    </div>
  );
}

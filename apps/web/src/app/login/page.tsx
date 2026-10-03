import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export default function LoginPage() {
  return (
    <div className="auth">
      <div className="card stack">
        <h1>Entrar</h1>
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

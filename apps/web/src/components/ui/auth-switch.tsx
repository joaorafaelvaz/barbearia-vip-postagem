"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { IconAlert, IconMegaphone, IconStore, IconUser } from "../Icons";
import "./auth-switch.css";

export type AuthMode = "signin" | "signup";

const IconMail = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
);
const IconLock = () => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);

function Field({ id, icon, ...input }: { id: string; icon: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="as-field">
      {icon}
      <label className="visually-hidden" htmlFor={id}>{input.placeholder}</label>
      <input id={id} {...input} />
    </div>
  );
}

/**
 * Login e cadastro em um único painel deslizante.
 * `mode` inicial vem da rota (/login ou /registro); alternar atualiza a URL.
 * O formulário ativo vem primeiro no DOM e usa os ids simples (#email, #password).
 */
export default function AuthSwitch({ mode: initial }: { mode: AuthMode }) {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<AuthMode>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signUp = mode === "signup";

  function switchTo(next: AuthMode) {
    setMode(next);
    setError(null);
    router.replace(next === "signup" ? "/registro" : "/login");
  }

  async function submit(e: FormEvent<HTMLFormElement>, endpoint: "login" | "register") {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    const res = await fetch(`/api/auth/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Falha ao autenticar.");
      return;
    }
    router.push(params.get("next") ?? "/");
    router.refresh();
  }

  const ids = (form: AuthMode, name: string) => (form === mode ? name : `${form}-${name}`);

  const signIn = (
    <form key="signin" className={signUp ? "inactive" : "active"} onSubmit={(e) => submit(e, "login")} aria-hidden={signUp} noValidate={signUp}>
      <div className="as-brand"><span className="mark"><IconMegaphone /></span> Publicador da Rede</div>
      <h2 className="as-title">Entrar</h2>
      <Field id={ids("signin", "email")} name="email" type="email" placeholder="E-mail" autoComplete="email" required icon={<IconMail />} tabIndex={signUp ? -1 : 0} />
      <Field id={ids("signin", "password")} name="password" type="password" placeholder="Senha" autoComplete="current-password" required icon={<IconLock />} tabIndex={signUp ? -1 : 0} />
      {!signUp && error && <div className="alert error as-error" role="alert"><IconAlert size="sm" /><span>{error}</span></div>}
      <button type="submit" className="as-btn" disabled={busy || signUp} tabIndex={signUp ? -1 : 0}>{busy && !signUp ? "Entrando..." : "Entrar"}</button>
    </form>
  );

  const register = (
    <form key="signup" className={signUp ? "active" : "inactive"} onSubmit={(e) => submit(e, "register")} aria-hidden={!signUp} noValidate={!signUp}>
      <div className="as-brand"><span className="mark"><IconMegaphone /></span> Publicador da Rede</div>
      <h2 className="as-title">Criar conta da rede</h2>
      <Field id={ids("signup", "organizationName")} name="organizationName" type="text" placeholder="Nome da rede / franqueadora" required minLength={2} icon={<IconStore />} tabIndex={signUp ? 0 : -1} />
      <Field id={ids("signup", "name")} name="name" type="text" placeholder="Seu nome" required minLength={2} autoComplete="name" icon={<IconUser />} tabIndex={signUp ? 0 : -1} />
      <Field id={ids("signup", "email")} name="email" type="email" placeholder="E-mail" autoComplete="email" required icon={<IconMail />} tabIndex={signUp ? 0 : -1} />
      <Field id={ids("signup", "password")} name="password" type="password" placeholder="Senha (mínimo 8 caracteres)" autoComplete="new-password" required minLength={8} icon={<IconLock />} tabIndex={signUp ? 0 : -1} />
      {signUp && error && <div className="alert error as-error" role="alert"><IconAlert size="sm" /><span>{error}</span></div>}
      <button type="submit" className="as-btn" disabled={busy || !signUp} tabIndex={signUp ? 0 : -1}>{busy && signUp ? "Criando..." : "Criar conta"}</button>
    </form>
  );

  return (
    <div className="auth-switch">
      <div className={`as-container ${signUp ? "sign-up-mode" : ""}`}>
        <div className="as-forms">
          <div className="as-stage">{signUp ? <>{register}{signIn}</> : <>{signIn}{register}</>}</div>
        </div>
        <div className="as-panels">
          <div className="as-panel left">
            <div className="content">
              <h3>Primeira vez aqui?</h3>
              <p>Crie a conta da sua rede, cadastre as unidades e agende a mesma postagem para todas elas.</p>
              <button type="button" className="as-btn transparent" onClick={() => switchTo("signup")}>Criar conta</button>
            </div>
          </div>
          <div className="as-panel right">
            <div className="content">
              <h3>Já tem conta?</h3>
              <p>Entre para acompanhar o painel e as publicações das suas unidades.</p>
              <button type="button" className="as-btn transparent" onClick={() => switchTo("signin")}>Entrar</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

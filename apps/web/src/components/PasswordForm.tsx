"use client";

import { useState, type FormEvent } from "react";
import { IconAlert, IconCheck } from "./Icons";

export function PasswordForm() {
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
    if (data.newPassword !== data.confirm) {
      setStatus({ error: "A confirmação não confere com a nova senha." });
      return;
    }
    setBusy(true);
    setStatus({});
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: data.currentPassword, newPassword: data.newPassword }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setStatus({ error: body.error ?? "Não foi possível alterar a senha." });
      return;
    }
    setStatus({ ok: "Senha alterada." });
    setFormKey((k) => k + 1);
  }

  return (
    <form key={formKey} onSubmit={onSubmit} className="stack" style={{ maxWidth: 420 }}>
      <div className="field">
        <label htmlFor="currentPassword">Senha atual</label>
        <input id="currentPassword" name="currentPassword" type="password" required autoComplete="current-password" />
      </div>
      <div className="field">
        <label htmlFor="newPassword">Nova senha</label>
        <input id="newPassword" name="newPassword" type="password" required minLength={8} autoComplete="new-password" />
        <small className="hint">Mínimo de 8 caracteres.</small>
      </div>
      <div className="field">
        <label htmlFor="confirm">Confirmar nova senha</label>
        <input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      {status.error && <div className="alert error" role="alert"><IconAlert size="sm" /><span>{status.error}</span></div>}
      {status.ok && <div className="alert ok" role="status"><IconCheck size="sm" /><span>{status.ok}</span></div>}
      <div><button className="btn primary" type="submit" disabled={busy}>{busy ? "Salvando..." : "Alterar senha"}</button></div>
    </form>
  );
}

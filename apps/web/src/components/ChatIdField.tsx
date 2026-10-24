"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { IconAlert, IconCheck } from "./Icons";

interface Props {
  /** rota PATCH que recebe { whatsappChatId } */
  endpoint: string;
  value: string | null;
  label: string;
  id: string;
  hint?: string;
}

/** Campo "chat id do WhatsApp" com salvar inline (mesmo padrão de PasswordForm: fetch + router.refresh). Vazio apaga. */
export function ChatIdField({ endpoint, value, label, id, hint }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok?: string; error?: string }>({});

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const whatsappChatId = String(new FormData(e.currentTarget).get("whatsappChatId") ?? "").trim();
    setBusy(true);
    setStatus({});
    const res = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ whatsappChatId }) });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; details?: { fieldErrors?: Record<string, string[]> } };
      setStatus({ error: body.details?.fieldErrors?.whatsappChatId?.[0] ?? body.error ?? "Não foi possível salvar." });
      return;
    }
    setStatus({ ok: whatsappChatId ? "Salvo." : "Removido." });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="field">
      <label htmlFor={id}>{label}</label>
      <div className="row">
        <input id={id} name="whatsappChatId" type="text" defaultValue={value ?? ""} placeholder="120363424632069171@g.us" pattern="^\d{5,20}(-\d+)?@(g|c)\.us$|^$" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn small" type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar"}</button>
      </div>
      {hint && <small className="hint">{hint}</small>}
      {status.error && <small className="field-error" role="alert"><IconAlert size="sm" />{status.error}</small>}
      {status.ok && <small className="hint" role="status" style={{ color: "var(--ok)" }}><IconCheck size="sm" /> {status.ok}</small>}
    </form>
  );
}

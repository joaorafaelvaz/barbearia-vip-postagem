"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { IconAlert, IconCheck } from "./Icons";
import { UserCard, type ManagedUser, type UnitOption } from "./UserCard";

export type { ManagedUser, UnitOption } from "./UserCard";

async function patchUser(id: string, body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(`/api/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const b = (await res.json().catch(() => ({}))) as { error?: string };
  return b.error ?? "Erro ao salvar";
}

export function UserManager({ users, units, meId }: { users: ManagedUser[]; units: UnitOption[]; meId: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  async function run(id: string, body: Record<string, unknown>, ok: string) {
    setBusy(id);
    setMsg({});
    const err = await patchUser(id, body);
    setBusy(null);
    setMsg(err ? { error: err } : { ok });
    if (!err) router.refresh();
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = { name: fd.get("name"), email: fd.get("email"), password: fd.get("password"), role: fd.get("role"), unitIds: fd.getAll("unitIds") };
    setBusy("new");
    setMsg({});
    const res = await fetch("/api/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg({ error: b.error ?? "Erro ao criar usuário" });
      return;
    }
    setMsg({ ok: "Usuário criado. Informe a senha inicial a ele; ele pode trocá-la em “Minha conta”." });
    setFormKey((k) => k + 1);
    router.refresh();
  }

  return (
    <div className="stack lg">
      {msg.error && <div className="alert error" role="alert"><IconAlert size="sm" /><span>{msg.error}</span></div>}
      {msg.ok && <div className="alert ok" role="status"><IconCheck size="sm" /><span>{msg.ok}</span></div>}

      <form key={formKey} onSubmit={create} className="card stack">
        <h2 style={{ margin: 0 }}>Novo usuário</h2>
        <div className="grid cols-3">
          <div className="field"><label htmlFor="u-name">Nome</label><input id="u-name" name="name" type="text" required minLength={2} /></div>
          <div className="field"><label htmlFor="u-email">E-mail</label><input id="u-email" name="email" type="email" required /></div>
          <div className="field"><label htmlFor="u-pass">Senha inicial</label><input id="u-pass" name="password" type="password" required minLength={8} autoComplete="new-password" /></div>
        </div>
        <div className="field">
          <label htmlFor="u-role">Papel</label>
          <select id="u-role" name="role" defaultValue="MANAGER" style={{ maxWidth: 320 }}>
            <option value="MANAGER">Gestor (só as unidades delegadas)</option>
            <option value="OWNER">Administrador (todas as unidades, gerencia usuários)</option>
          </select>
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: "var(--fs-sm)", fontWeight: 600, marginBottom: 6 }}>Unidades delegadas (para gestores)</legend>
          <div className="row">
            {units.length === 0 && <small>Cadastre unidades primeiro.</small>}
            {units.map((u) => (
              <label key={u.id} className="chip"><input type="checkbox" name="unitIds" value={u.id} /> {u.name}</label>
            ))}
          </div>
        </fieldset>
        <div><button className="btn primary" type="submit" disabled={busy === "new"}>{busy === "new" ? "Criando..." : "Criar usuário"}</button></div>
      </form>

      <div className="stack">
        {users.map((u) => <UserCard key={u.id} user={u} units={units} isMe={u.id === meId} busy={busy === u.id} onChange={(body, ok) => run(u.id, body, ok)} />)}
      </div>
    </div>
  );
}

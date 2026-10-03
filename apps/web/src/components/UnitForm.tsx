"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

const TIMEZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Belem",
  "America/Fortaleza",
  "America/Recife",
  "America/Bahia",
  "America/Cuiaba",
  "America/Campo_Grande",
  "America/Porto_Velho",
  "America/Boa_Vista",
  "America/Rio_Branco",
  "America/Noronha",
];

export function UnitForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = Object.fromEntries(new FormData(e.currentTarget).entries());
    const res = await fetch("/api/units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Erro ao criar unidade");
      return;
    }
    setFormKey((k) => k + 1); // remonta o formulário limpo
    router.refresh();
  }

  return (
    <form key={formKey} onSubmit={onSubmit} className="card stack">
      <h2 style={{ margin: 0 }}>Nova unidade</h2>
      <div className="grid cols-3">
        <div>
          <label htmlFor="name">Nome</label>
          <input id="name" name="name" type="text" required placeholder="Ex.: Unidade Centro" />
        </div>
        <div>
          <label htmlFor="city">Cidade</label>
          <input id="city" name="city" type="text" placeholder="Opcional" />
        </div>
        <div>
          <label htmlFor="timezone">Fuso horário</label>
          <select id="timezone" name="timezone" defaultValue="America/Sao_Paulo">
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div>
        <button className="btn primary" type="submit" disabled={busy}>Adicionar unidade</button>
      </div>
    </form>
  );
}

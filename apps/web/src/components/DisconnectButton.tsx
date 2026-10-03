"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DisconnectButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!confirm("Desconectar esta conta? Postagens agendadas para ela vão falhar.")) return;
    setBusy(true);
    await fetch(`/api/accounts/${id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }
  return (
    <button className="btn small danger" disabled={busy} onClick={run}>Desconectar</button>
  );
}

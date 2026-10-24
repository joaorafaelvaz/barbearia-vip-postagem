import { DELIVERY_STATUS_LABELS, formatInTz, shorten } from "@/lib/format";

export interface DeliveryRow { id: string; sentAt: string; targetName: string; status: string; text: string; error: string | null }

/** Histórico por destino (últimos 200 envios), sempre no horário de Brasília. */
export function NoticeHistory({ rows }: { rows: DeliveryRow[] }) {
  return (
    <section className="card stack" aria-labelledby="historico">
      <h2 id="historico" style={{ margin: 0 }}>Histórico (últimos 200 envios)</h2>
      {rows.length === 0 ? <div className="empty"><strong>Nenhum envio ainda</strong></div> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Quando</th><th>Destino</th><th>Status</th><th>Texto</th><th>Erro</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const st = DELIVERY_STATUS_LABELS[r.status] ?? { label: r.status, badge: "" };
                return (
                  <tr key={r.id}>
                    <td>{formatInTz(new Date(r.sentAt), "America/Sao_Paulo")}</td>
                    <td>{r.targetName}</td>
                    <td><span className={`badge ${st.badge}`}>{st.label}</span></td>
                    <td title={r.text}>{shorten(r.text)}</td>
                    <td><small>{r.error ?? ""}</small></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

import type { DayPoint } from "@/lib/analytics-utils";

/** Gráfico de barras empilhadas (publicadas × falhas) por dia, em SVG, com tabela acessível. */
export function DailyBarChart({ series, title }: { series: DayPoint[]; title: string }) {
  const max = Math.max(1, ...series.map((d) => d.published + d.failed));
  const W = 720, H = 180, pad = 28, gap = 2;
  const bw = Math.max(2, (W - pad * 2) / series.length - gap);
  const every = series.length > 31 ? 7 : series.length > 10 ? 3 : 1;
  const labels = series.filter((_, i) => i % every === 0 || i === series.length - 1);
  return (
    <figure className="chart" style={{ margin: 0 }}>
      <figcaption className="visually-hidden">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ width: "100%", height: "auto", display: "block" }}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad} x2={W - pad} y1={pad + (H - pad * 2) * (1 - f)} y2={pad + (H - pad * 2) * (1 - f)} stroke="var(--border)" strokeDasharray="3 3" />
            <text x={pad - 6} y={pad + (H - pad * 2) * (1 - f) + 4} fontSize="10" fill="var(--muted)" textAnchor="end">{Math.round(max * f)}</text>
          </g>
        ))}
        {series.map((d, i) => {
          const x = pad + i * (bw + gap);
          const hp = ((H - pad * 2) * d.published) / max;
          const hf = ((H - pad * 2) * d.failed) / max;
          const base = H - pad;
          return (
            <g key={d.day}>
              <title>{`${d.day}: ${d.published} publicadas, ${d.failed} falhas`}</title>
              <rect x={x} y={base - hp} width={bw} height={hp} fill="var(--ok)" rx="2" />
              <rect x={x} y={base - hp - hf} width={bw} height={hf} fill="var(--err)" rx="2" />
            </g>
          );
        })}
        {labels.map((d) => {
          const i = series.indexOf(d);
          return <text key={d.day} x={pad + i * (bw + gap) + bw / 2} y={H - 8} fontSize="10" fill="var(--muted)" textAnchor="middle">{d.day.slice(8)}/{d.day.slice(5, 7)}</text>;
        })}
      </svg>
      <div className="legend" aria-hidden="true"><span><i style={{ background: "var(--ok)" }} /> Publicadas</span><span><i style={{ background: "var(--err)" }} /> Falhas</span></div>
      <table className="visually-hidden">
        <caption>{title}</caption>
        <thead><tr><th scope="col">Dia</th><th scope="col">Publicadas</th><th scope="col">Falhas</th></tr></thead>
        <tbody>{series.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.published}</td><td>{d.failed}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

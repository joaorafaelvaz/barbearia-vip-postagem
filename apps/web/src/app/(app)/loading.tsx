export default function Loading() {
  return (
    <div className="stack lg" aria-busy="true" aria-label="Carregando">
      <div className="skeleton" style={{ width: 220, height: 32 }} />
      <div className="kpis">
        <div className="skeleton" style={{ height: 84 }} />
        <div className="skeleton" style={{ height: 84 }} />
        <div className="skeleton" style={{ height: 84 }} />
      </div>
      <div className="skeleton" style={{ height: 320 }} />
    </div>
  );
}

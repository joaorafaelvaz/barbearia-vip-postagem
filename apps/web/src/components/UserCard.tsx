"use client";

export interface ManagedUser {
  id: string;
  name: string | null;
  email: string;
  role: "OWNER" | "MANAGER";
  isActive: boolean;
  unitIds: string[];
}
export interface UnitOption { id: string; name: string }

interface Props {
  user: ManagedUser;
  units: UnitOption[];
  isMe: boolean;
  busy: boolean;
  onChange: (body: Record<string, unknown>, okMessage: string) => void;
}

export function UserCard({ user: u, units, isMe, busy, onChange }: Props) {
  return (
    <section className="card stack" aria-label={u.email} style={u.isActive ? undefined : { opacity: 0.7 }}>
      <div className="row between">
        <div>
          <strong>{u.name ?? u.email}</strong>{" "}
          {isMe && <span className="badge platform">você</span>}{" "}
          {!u.isActive && <span className="badge CANCELLED">desativado</span>}
          <br /><small>{u.email}</small>
        </div>
        <div className="row">
          <label className="visually-hidden" htmlFor={`role-${u.id}`}>Papel de {u.email}</label>
          <select id={`role-${u.id}`} value={u.role} disabled={isMe || busy} onChange={(e) => onChange({ role: e.target.value }, "Papel atualizado.")} style={{ width: "auto", minHeight: "var(--control-h-sm)" }}>
            <option value="MANAGER">Gestor</option>
            <option value="OWNER">Administrador</option>
          </select>
          {!isMe && (
            <button className={`btn small ${u.isActive ? "danger" : ""}`} disabled={busy} onClick={() => onChange({ isActive: !u.isActive }, u.isActive ? "Usuário desativado." : "Usuário reativado.")}>
              {u.isActive ? "Desativar" : "Reativar"}
            </button>
          )}
        </div>
      </div>
      {u.role === "MANAGER" ? (
        <div className="row" role="group" aria-label={`Unidades delegadas a ${u.name ?? u.email}`}>
          {units.length === 0 && <small>Nenhuma unidade cadastrada.</small>}
          {units.map((unit) => {
            const on = u.unitIds.includes(unit.id);
            return (
              <label key={unit.id} className={`chip ${on ? "on" : ""}`}>
                <input type="checkbox" checked={on} disabled={busy} onChange={() => onChange({ unitIds: on ? u.unitIds.filter((x) => x !== unit.id) : [...u.unitIds, unit.id] }, "Delegação atualizada.")} />
                {unit.name}
              </label>
            );
          })}
        </div>
      ) : (
        <small>Administrador: acesso a todas as unidades e à gestão de usuários.</small>
      )}
    </section>
  );
}

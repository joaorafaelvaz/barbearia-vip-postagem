import { redirect } from "next/navigation";
import { UserManager } from "@/components/UserManager";
import { isAdmin } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { listUsers } from "@/lib/services/users";
import { requireSession } from "@/lib/session";

export default async function UsersPage() {
  const s = await requireSession();
  if (!isAdmin(s)) redirect("/");
  const [users, units] = await Promise.all([
    listUsers(prisma, s.organizationId),
    prisma.unit.findMany({ where: { organizationId: s.organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="stack lg">
      <div className="page-head">
        <div>
          <h1>Usuários e permissões</h1>
          <p className="lead">Administradores veem tudo e cadastram unidades. Gestores só acessam as unidades que você delegar a eles.</p>
        </div>
      </div>
      <UserManager meId={s.userId} units={units} users={users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, isActive: u.isActive, unitIds: u.units.map((x) => x.unitId) }))} />
    </div>
  );
}

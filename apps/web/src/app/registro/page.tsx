import { redirect } from "next/navigation";
import { Suspense } from "react";
import AuthSwitch from "@/components/ui/auth-switch";
import { prisma } from "@/lib/db";
import { isSignupOpen } from "@/lib/services/auth";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (!(await isSignupOpen(prisma))) redirect("/login?cadastro=fechado");
  return (
    <Suspense>
      <AuthSwitch mode="signup" />
    </Suspense>
  );
}

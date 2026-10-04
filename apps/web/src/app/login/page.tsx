import { Suspense } from "react";
import AuthSwitch from "@/components/ui/auth-switch";
import { prisma } from "@/lib/db";
import { isSignupOpen } from "@/lib/services/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const allowSignup = await isSignupOpen(prisma);
  return (
    <Suspense>
      <AuthSwitch mode="signin" allowSignup={allowSignup} />
    </Suspense>
  );
}

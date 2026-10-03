import { Suspense } from "react";
import AuthSwitch from "@/components/ui/auth-switch";

export default function RegisterPage() {
  return (
    <Suspense>
      <AuthSwitch mode="signup" />
    </Suspense>
  );
}

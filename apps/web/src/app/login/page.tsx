import { Suspense } from "react";
import AuthSwitch from "@/components/ui/auth-switch";

export default function LoginPage() {
  return (
    <Suspense>
      <AuthSwitch mode="signin" />
    </Suspense>
  );
}

import { describe, expect, it } from "vitest";
import { isAdmin, requireAdmin } from "./authz";
import type { SessionUser } from "./session";

const base: Omit<SessionUser, "role"> = { userId: "u1", organizationId: "o1", email: "x@y.z", name: null };

describe("requireAdmin", () => {
  it("MANAGER recebe 403", () => {
    expect(isAdmin({ ...base, role: "MANAGER" })).toBe(false);
    expect(() => requireAdmin({ ...base, role: "MANAGER" })).toThrow(expect.objectContaining({ status: 403 }));
  });
  it("OWNER passa", () => {
    expect(isAdmin({ ...base, role: "OWNER" })).toBe(true);
    expect(() => requireAdmin({ ...base, role: "OWNER" })).not.toThrow();
  });
});

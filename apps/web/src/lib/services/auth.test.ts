import { afterEach, describe, expect, it } from "vitest";
import { isSignupOpen, register } from "./auth";

function fakePrisma(orgCount: number) {
  return {
    organization: { count: async () => orgCount, create: async () => ({ id: "org", users: [{ id: "u", email: "a@b.c", name: "A" }] }) },
    user: { findUnique: async () => null },
  } as never;
}

const original = process.env.ALLOW_SIGNUP;
afterEach(() => {
  if (original === undefined) delete process.env.ALLOW_SIGNUP;
  else process.env.ALLOW_SIGNUP = original;
});

describe("isSignupOpen", () => {
  it("aberto enquanto não existe organização", async () => {
    delete process.env.ALLOW_SIGNUP;
    expect(await isSignupOpen(fakePrisma(0))).toBe(true);
  });

  it("fechado depois da primeira organização", async () => {
    delete process.env.ALLOW_SIGNUP;
    expect(await isSignupOpen(fakePrisma(1))).toBe(false);
  });

  it("ALLOW_SIGNUP=true mantém aberto", async () => {
    process.env.ALLOW_SIGNUP = "true";
    expect(await isSignupOpen(fakePrisma(5))).toBe(true);
  });

  it("register responde 403 quando fechado", async () => {
    delete process.env.ALLOW_SIGNUP;
    await expect(
      register(fakePrisma(1), { organizationName: "Rede", name: "Dono", email: "dono@x.com", password: "senha-forte-1" }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

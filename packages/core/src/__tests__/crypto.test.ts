import { describe, expect, it } from "vitest";
import { TokenCipher, generateEncryptionKey } from "../crypto.js";

describe("TokenCipher", () => {
  it("roundtrip encrypt/decrypt", () => {
    const cipher = new TokenCipher(generateEncryptionKey());
    const token = "EAAB-page-access-token-123";
    const enc = cipher.encrypt(token);
    expect(enc).not.toContain(token);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(cipher.decrypt(enc)).toBe(token);
  });

  it("produz ciphertexts diferentes para o mesmo plaintext (IV aleatório)", () => {
    const cipher = new TokenCipher(generateEncryptionKey());
    expect(cipher.encrypt("x")).not.toBe(cipher.encrypt("x"));
  });

  it("rejeita chave de tamanho errado", () => {
    expect(() => new TokenCipher(Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
  });

  it("falha ao decifrar com outra chave ou payload adulterado", () => {
    const a = new TokenCipher(generateEncryptionKey());
    const b = new TokenCipher(generateEncryptionKey());
    const enc = a.encrypt("segredo");
    expect(() => b.decrypt(enc)).toThrow();
    const tampered = enc.slice(0, -2) + (enc.endsWith("A") ? "B=" : "A=");
    expect(() => a.decrypt(tampered)).toThrow();
  });
});

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Criptografia simétrica AES-256-GCM para segredos em repouso (tokens de acesso).
 * Formato persistido: `v1:<iv b64>:<tag b64>:<ciphertext b64>`.
 */
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const VERSION = "v1";

export class TokenCipher {
  private readonly key: Buffer;

  constructor(keyBase64: string) {
    const key = Buffer.from(keyBase64, "base64");
    if (key.length !== 32) {
      throw new Error("APP_ENCRYPTION_KEY precisa ter 32 bytes em base64 (AES-256).");
    }
    this.key = key;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): TokenCipher {
    const key = env.APP_ENCRYPTION_KEY;
    if (!key) throw new Error("APP_ENCRYPTION_KEY não definida.");
    return new TokenCipher(key);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
  }

  decrypt(payload: string): string {
    const parts = payload.split(":");
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error("Payload criptografado em formato inválido.");
    }
    const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
    const decipher = createDecipheriv(ALGO, this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  }
}

/** Gera uma chave nova em base64, útil para setup local. */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString("base64");
}

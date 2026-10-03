import { TokenCipher } from "@fsp/core";

let cipher: TokenCipher | undefined;

export function getCipher(): TokenCipher {
  if (!cipher) cipher = TokenCipher.fromEnv();
  return cipher;
}

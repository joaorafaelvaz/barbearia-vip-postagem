import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Carrega o pacote compilado com o Node real (ESM). O executor de testes tolera ciclos de
 * importação que o Node não tolera (TDZ em constantes), e isso já derrubou o worker em produção.
 */
describe("carga do pacote compilado no Node", () => {
  const dist = path.resolve(process.cwd(), "dist/index.js");
  it.skipIf(!existsSync(dist))("importa dist/index.js sem erro", () => {
    const url = pathToFileURL(dist).href;
    const script = "import(" + JSON.stringify(url) + ").then(function (m) { console.log(Object.keys(m).length > 10 ? 'ok' : 'poucos exports'); })";
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    expect(out.trim()).toBe("ok");
  });
});

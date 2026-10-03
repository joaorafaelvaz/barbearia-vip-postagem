import { describe, expect, it } from "vitest";
import { uploadMedia, type Storage } from "./media";

const storage: Storage = {
  async put(key) {
    return { storageKey: key, publicUrl: `https://cdn.test/${key}` };
  },
};

function fakePrisma() {
  const created: unknown[] = [];
  const prisma = {
    mediaAsset: {
      async create(args: { data: Record<string, unknown> }) {
        created.push(args.data);
        return { id: "m1", ...args.data };
      },
    },
  };
  return { prisma: prisma as never, created };
}

// PNG 1x1 válido
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

describe("uploadMedia", () => {
  it("vídeo MP4 usa metadados do navegador e marca kind=VIDEO", async () => {
    const { prisma, created } = fakePrisma();
    const r = await uploadMedia({ prisma, storage }, "org1", {
      name: "reel.mp4",
      type: "video/mp4",
      bytes: Buffer.alloc(1024),
      videoMeta: { width: 1080, height: 1920, durationSec: 12.4 },
    });
    expect(r.kind).toBe("VIDEO");
    expect(r.durationSec).toBe(12);
    expect(r.publicUrl).toMatch(/\.mp4$/);
    expect(created[0]).toMatchObject({ kind: "VIDEO", width: 1080, height: 1920, durationSec: 12 });
    // Google não aceita vídeo: aviso esperado só para ele
    expect(r.issues.map((i) => i.platform)).toEqual(["GOOGLE_BUSINESS_PROFILE"]);
  });

  it("vídeo curto demais gera aviso do Instagram", async () => {
    const { prisma } = fakePrisma();
    const r = await uploadMedia({ prisma, storage }, "org1", {
      name: "a.mov",
      type: "video/quicktime",
      bytes: Buffer.alloc(10),
      videoMeta: { width: 720, height: 1280, durationSec: 1 },
    });
    expect(r.issues.some((i) => i.platform === "INSTAGRAM" && /3s/.test(i.message))).toBe(true);
  });

  it("imagem PNG lê dimensões no servidor e marca kind=IMAGE", async () => {
    const { prisma } = fakePrisma();
    const r = await uploadMedia({ prisma, storage }, "org1", { name: "a.png", type: "image/png", bytes: png });
    expect(r.kind).toBe("IMAGE");
    expect(r.width).toBe(1);
    expect(r.height).toBe(1);
  });

  it("formato não suportado é recusado", async () => {
    const { prisma } = fakePrisma();
    await expect(
      uploadMedia({ prisma, storage }, "org1", { name: "a.webm", type: "video/webm", bytes: Buffer.alloc(10) }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

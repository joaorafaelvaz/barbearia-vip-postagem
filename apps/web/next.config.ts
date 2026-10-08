import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";
import path from "node:path";

// Carrega o .env da raiz do monorepo (uma única fonte para web, worker e prisma).
loadEnv({ path: path.resolve(process.cwd(), "../../.env") });

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../../"),
  transpilePackages: ["@fsp/core", "@fsp/connectors", "@fsp/db", "@fsp/queue"],
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis", "@aws-sdk/client-s3"],
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
    // Com middleware.ts presente, o Next corta o corpo das rotas em 10MB por padrão.
    // Uploads de vídeo vão até 300MB (MAX_VIDEO_BYTES); nginx aceita 320m.
    middlewareClientMaxBodySize: "320mb",
  },
};

export default nextConfig;

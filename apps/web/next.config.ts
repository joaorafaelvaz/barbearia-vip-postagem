import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";
import path from "node:path";

// Carrega o .env da raiz do monorepo (uma única fonte para web, worker e prisma).
loadEnv({ path: path.resolve(process.cwd(), "../../.env") });

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@fsp/core", "@fsp/connectors", "@fsp/db", "@fsp/queue"],
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis", "@aws-sdk/client-s3"],
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;

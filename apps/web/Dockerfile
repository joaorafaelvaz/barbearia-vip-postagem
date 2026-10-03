# Imagem do app web (Next.js standalone). Contexto de build: raiz do monorepo.
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl && corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @fsp/db generate \
 && pnpm -r --filter "./packages/*" build \
 && pnpm --filter @fsp/web build
# O standalone do Next não leva o motor do Prisma; copia para um caminho que o client procura em runtime.
RUN set -e; SRC="$(find node_modules/.pnpm -maxdepth 1 -type d -name "@prisma+client@*" | head -1)/node_modules/.prisma/client";     test -d "$SRC"; mkdir -p apps/web/.next/standalone/apps/web/.prisma; cp -r "$SRC" apps/web/.next/standalone/apps/web/.prisma/client;     ls apps/web/.next/standalone/apps/web/.prisma/client | grep -q "libquery_engine"

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3022
ENV HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
RUN mkdir -p /app/apps/web/public/uploads && chown -R node:node /app
USER node
EXPOSE 3022
CMD ["node", "apps/web/server.js"]

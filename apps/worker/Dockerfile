# Imagem do worker (BullMQ) e das migrations. Contexto de build: raiz do monorepo.
FROM node:22-alpine AS base
# ffmpeg: corte automático de vídeos longos para Stories
RUN apk add --no-cache libc6-compat openssl ffmpeg && corepack enable && corepack prepare pnpm@11.3.0 --activate
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @fsp/db generate \
 && pnpm -r --filter "./packages/*" build \
 && pnpm --filter @fsp/worker build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
CMD ["node", "apps/worker/dist/main.js"]

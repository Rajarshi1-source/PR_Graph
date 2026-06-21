# PRGraph uses a CUSTOM server (Next request handler + Socket.IO in one process), so we do NOT use
# Next's `output:'standalone'`. We build .next normally, compile server/websocket.ts to a single ESM
# file (dist/server.mjs), and ship a production node_modules. See plan §9.1.
# syntax=docker/dockerfile:1

# 1) deps — full install (dev + prod), used only to build
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# 2) builder — generate Prisma client, build Next, bundle the custom server
FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Placeholder so `prisma generate` can resolve env("DATABASE_URL") in prisma.config.ts (no DB needed).
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build            # next build (Turbopack) → .next
RUN npm run build:server     # esbuild server/websocket.ts → dist/server.mjs

# 3) prod-deps — clean production-only node_modules (no dev tooling in the runtime image)
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 4) runner — minimal runtime image
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# production deps, then overlay the Prisma client generated in the builder
COPY --from=prod-deps /app/node_modules                ./node_modules
COPY --from=builder   /app/node_modules/.prisma        ./node_modules/.prisma
COPY --from=builder   /app/node_modules/@prisma/client ./node_modules/@prisma/client

# app artifacts: the real .next build (NOT .next/standalone), assets, prisma, compiled server, config
COPY --from=builder /app/.next            ./.next
COPY --from=builder /app/public           ./public
COPY --from=builder /app/prisma           ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/dist             ./dist
COPY --from=builder /app/next.config.*    ./
COPY --from=builder /app/package.json     ./package.json
COPY scripts/start.sh ./start.sh
RUN chmod +x start.sh && chown -R nextjs:nodejs /app

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["./start.sh"]

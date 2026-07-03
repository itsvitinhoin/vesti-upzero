FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# O entrypoint do Cloud Run Job (scripts/jobs/run-sync-job.ts) roda via tsx fora do
# bundle standalone do Next, entao precisa do node_modules completo (merge sobre o
# node_modules reduzido do standalone) e do codigo fonte de lib/ e scripts/.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --chown=nextjs:nodejs lib ./lib
COPY --chown=nextjs:nodejs scripts ./scripts
COPY --chown=nextjs:nodejs tsconfig.json ./tsconfig.json

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]

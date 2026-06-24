# ── Build Stage ────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Production Stage ───────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/packages/core/db/educational_os.db ./packages/core/db/educational_os.db 2>/dev/null || true

ENV NODE_ENV=production
ENV PORT=9000

EXPOSE 9000
CMD ["node", "dist/server.cjs"]

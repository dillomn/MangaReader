# syntax=docker/dockerfile:1

# ---- Build stage: compile the React frontend to static files ----
FROM node:20-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Runtime stage: Node server + bundled Chromium ----
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production \
    SERVE_STATIC=1 \
    PORT=3001 \
    CHROME_PATH=/usr/bin/chromium

# Chromium powers the Mangapill scraper (puppeteer-core drives this system
# binary). MangaDex and Gold Split work without it, so the server still runs
# even if this ever fails to launch.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install only runtime dependencies (no Vite/TypeScript/etc.)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Server code + the frontend built in the previous stage
COPY proxy.mjs ./
COPY server ./server
COPY --from=build /app/dist ./dist

# Runtime data (accounts, progress, persisted JWT secret) lives here.
# Mount a volume at this path to persist it across container recreation.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3001
CMD ["node", "proxy.mjs"]

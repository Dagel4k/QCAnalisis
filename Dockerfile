FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Copiamos SOLO los package.json
COPY package.json ./
COPY packages/dev-tools/package.json ./packages/dev-tools/
COPY repo-scan-dashboard-main/package.json ./repo-scan-dashboard-main/

# 2. Instalamos dependencias de la raíz
RUN npm install

# 3. Instalamos dependencias del Dashboard
WORKDIR /app/repo-scan-dashboard-main
RUN npm install

# error EBADPLATFORM y satisface a Rollup
RUN npm install @rollup/rollup-linux-arm64-gnu

# 4. Copiar código
WORKDIR /app
COPY . .

# 5. Build frontend
WORKDIR /app/repo-scan-dashboard-main
RUN npm run build

# 6. Build Backend
RUN npx tsc -p server/tsconfig.json

# --- Runner ---
FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

EXPOSE 3000

WORKDIR /app/repo-scan-dashboard-main
CMD ["node", "server/dist/server/index.js"]

# GHOST PULSE – static build served by nginx (works out of the box on Coolify)

# ── 1. build ────────────────────────────────────────────────────────────────
# Node 24 runs the TypeScript test scripts natively (type stripping).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Fast logic tests first – a broken simulation never gets deployed.
RUN npm run test:sim && npm run test:weather && npm run test:streets && npm run test:walk && npm run test:opendata
RUN npm run build

# ── 2. serve ────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1

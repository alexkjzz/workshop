# syntax=docker/dockerfile:1

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Account and sensor history databases (SQLite), kept in a volume.
RUN mkdir -p data && chown node:node data
USER node
EXPOSE 3001
# HEALTHCHECK_URL is https://localhost:3001/... in production (CA from NODE_EXTRA_CA_CERTS).
ENV HEALTHCHECK_URL=http://127.0.0.1:3001/api/health
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD ["node", "-e", "fetch(process.env.HEALTHCHECK_URL).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]

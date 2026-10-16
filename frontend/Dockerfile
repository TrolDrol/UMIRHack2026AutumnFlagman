FROM node:24-alpine AS build
WORKDIR /build
COPY packages/demo-api/package*.json packages/demo-api/
RUN cd packages/demo-api && npm ci
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY packages/demo-api /build/packages/demo-api
COPY packages/portal-contracts /build/packages/portal-contracts
COPY frontend .
ARG FRONTEND_MODE=demo
RUN npm run build -- --mode "$FRONTEND_MODE" && node scripts/check-built-css.mjs

FROM nginx:1.28-alpine AS runtime
COPY frontend/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/frontend/dist /usr/share/nginx/html
COPY --from=build /build/packages/demo-api/node_modules/msw/lib/mockServiceWorker.js /usr/share/nginx/html/mockServiceWorker.js
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

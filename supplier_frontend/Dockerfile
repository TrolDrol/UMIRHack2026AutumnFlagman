FROM node:24-alpine AS build
WORKDIR /app
COPY packages ./packages
RUN npm ci --prefix /app/packages/demo-api --ignore-scripts
COPY supplier_frontend/package*.json ./supplier_frontend/
WORKDIR /app/supplier_frontend
RUN npm ci
COPY supplier_frontend ./
ARG VITE_DEMO_MODE=false
ARG VITE_INTEGRATIONS_BASE_URL=/integrations/v1
ENV VITE_DEMO_MODE=$VITE_DEMO_MODE VITE_INTEGRATIONS_BASE_URL=$VITE_INTEGRATIONS_BASE_URL
RUN npm run build
FROM nginx:1.28-alpine
COPY supplier_frontend/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/supplier_frontend/dist /usr/share/nginx/html/supplier
COPY --from=build /app/supplier_frontend/public/mockServiceWorker.js /usr/share/nginx/html/mockServiceWorker.js
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

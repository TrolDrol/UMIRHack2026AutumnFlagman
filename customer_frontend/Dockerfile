FROM node:22-alpine AS build
WORKDIR /code
COPY packages/demo-api/package*.json packages/demo-api/
RUN cd packages/demo-api && npm ci
COPY customer_frontend/package*.json customer_frontend/
RUN cd customer_frontend && npm ci
COPY packages/demo-api packages/demo-api
COPY packages/portal-contracts packages/portal-contracts
COPY customer_frontend customer_frontend
ARG DEMO_MODE=false
RUN cd customer_frontend && if [ "$DEMO_MODE" = "true" ]; then npm run build:demo; cp -r dist-demo dist; else npm run build; fi
FROM nginx:alpine
COPY customer_frontend/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /code/customer_frontend/dist/ /usr/share/nginx/html/client/
COPY --from=build /code/customer_frontend/public/mockServiceWorker.js /usr/share/nginx/html/mockServiceWorker.js
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=6 CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

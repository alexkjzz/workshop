# syntax=docker/dockerfile:1

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Unprivileged nginx: non-root user, HTTP 8080 (redirect) and HTTPS 8443.
FROM nginxinc/nginx-unprivileged:1.29-alpine
# The entrypoint renders templates (envsubst) into conf.d at startup.
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
USER 101
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV HTTPS_PORT=443
EXPOSE 8080 8443
HEALTHCHECK --interval=15s --timeout=3s \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]

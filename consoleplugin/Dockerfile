FROM node:20-slim AS builder
WORKDIR /consoleplugin
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps
COPY src/ ./src/
COPY tsconfig.json webpack.config.js plugin.json console-extensions.json ./
RUN npm run build

# ubi9/nginx-124: UBI-based, includes tar (not ubi-minimal), OpenShift-compatible non-root
FROM registry.access.redhat.com/ubi9/nginx-124

USER 0
COPY --from=builder /consoleplugin/dist/ /opt/app-root/src/
COPY nginx.conf /etc/nginx/nginx.conf
RUN chown -R 1001:0 /opt/app-root/src && chmod -R 755 /opt/app-root/src && \
    mkdir -p /var/serving-cert /tmp/client_temp /tmp/proxy_temp

USER 1001

EXPOSE 9443

LABEL io.openshift.managed.name="upgradediags" \
      io.openshift.managed.description="Console plugin for MUO upgrade diagnostics"

CMD ["nginx", "-g", "daemon off;"]

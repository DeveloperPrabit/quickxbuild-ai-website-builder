FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global bun@1.2.21

WORKDIR /workspace

COPY package.json bun.lock ./
COPY scripts/package.json scripts/package.json
COPY scripts/web-prod.sh scripts/web-prod.sh
COPY tooling tooling
COPY packages packages
COPY apps apps

RUN bun install \
  && chmod +x /workspace/scripts/web-prod.sh

WORKDIR /workspace/apps/web
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_SCAN=0
ENV ENVIRONMENT=production
ENV NEXT_PUBLIC_ENVIRONMENT=production
ENV AUTH_CROSS_SUBDOMAIN=0
EXPOSE 3000

CMD ["sh", "/workspace/scripts/web-prod.sh"]

FROM node:22-slim AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN yarn build && yarn install --frozen-lockfile --production

FROM node:22-slim
WORKDIR /app
# fonts-noto-cjk + fonts-dejavu-core: fallback glyphs (【】, CJK, symbols) in EPUB/PDF files
# upgrade: pick up Debian security fixes newer than the base image (CI scans the result)
RUN apt-get -o Acquire::Check-Date=false update -y && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends ca-certificates fonts-noto-cjk fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY assets ./assets
COPY migrations ./migrations

# Starts as root only to make the mounted folders writable for `node`, then runs as `node`
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/uploads /app/exports /app/.cache && chown node:node /app/uploads /app/exports /app/.cache
ENTRYPOINT ["docker-entrypoint.sh"]
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD ["node", "dist/server.js", "healthcheck"]
CMD ["node", "dist/server.js"]

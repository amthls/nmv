FROM node:22-slim AS builder

WORKDIR /app

RUN apt-get -o Acquire::Check-Date=false update -y && apt-get install -y openssl ca-certificates

COPY package.json yarn.lock* ./
RUN yarn install

COPY . .
RUN npx prisma generate
RUN yarn build

FROM node:22-slim AS runner

WORKDIR /app

# fonts-noto-cjk + fonts-dejavu-core: fallback glyphs (【】, CJK, symbols) for the EPUB/PDF export worker
# upgrade: pick up Debian security fixes newer than the base image (CI scans the result)
RUN apt-get -o Acquire::Check-Date=false update -y     && apt-get upgrade -y     && apt-get install -y --no-install-recommends openssl ca-certificates fonts-noto-cjk fonts-dejavu-core     && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/assets ./assets

# Runs as root just long enough to fix permissions on the mounted folders, then drops to `node`
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/uploads /app/exports /app/.cache && chown node:node /app/uploads /app/exports /app/.cache
ENTRYPOINT ["docker-entrypoint.sh"]

EXPOSE 5000

CMD ["node", "dist/server.js"]

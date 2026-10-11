FROM node:22-slim AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN yarn build && yarn install --frozen-lockfile --production

FROM node:22-slim
WORKDIR /app
# upgrade: pick up Debian security fixes newer than the base image (CI scans the result)
RUN apt-get -o Acquire::Check-Date=false update -y && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD ["node", "dist/server.js", "healthcheck"]
CMD ["node", "dist/server.js"]

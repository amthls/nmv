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

RUN apt-get -o Acquire::Check-Date=false update -y && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 5000

CMD ["node", "dist/server.js"]

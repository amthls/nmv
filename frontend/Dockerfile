FROM node:25-slim AS builder

WORKDIR /app

ARG NEXT_PUBLIC_API_URL=/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY package.json yarn.lock* ./
RUN yarn install --frozen-lockfile || yarn install

COPY . .
RUN yarn build

FROM node:25-slim AS runner

WORKDIR /app

# Debian security fixes newer than the base image (CI scans the result)
RUN apt-get -o Acquire::Check-Date=false update -y && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["yarn", "start", "-H", "0.0.0.0", "-p", "3000"]

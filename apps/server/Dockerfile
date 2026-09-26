# 构建上下文为 monorepo 根（见 docker-compose.yml）
FROM node:22-alpine
RUN corepack enable
WORKDIR /app

# 工作区清单（利用层缓存）
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile --filter @browser-dock/server --filter @browser-dock/shared

COPY apps/server apps/server
COPY packages/shared packages/shared

RUN pnpm --filter @browser-dock/server build

EXPOSE 3100
CMD ["node", "apps/server/dist/main.js"]

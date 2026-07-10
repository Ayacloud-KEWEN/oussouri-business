# OUSSOURI Web — 生产镜像（Next.js standalone）
# 构建上下文必须是仓库根目录: docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/web apps/web
ENV NEXT_OUTPUT=standalone
RUN pnpm --filter @oussouri/shared build && pnpm --filter @oussouri/web build

FROM node:22-alpine AS runner
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=builder --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
# standalone 产物不含 public 静态目录，须单独拷贝（省份图等 /public 资源）
COPY --from=builder --chown=app:app /app/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

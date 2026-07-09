# OUSSOURI API — 生产镜像（monorepo 构建）
# 构建上下文必须是仓库根目录: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @oussouri/shared build \
 && pnpm --filter @oussouri/api exec prisma generate \
 && pnpm --filter @oussouri/api build

FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate \
 && addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production
# 完整工作区拷贝（含 node_modules 与生成的 Prisma Client）；镜像瘦身列入 P2 优化
COPY --from=builder --chown=app:app /app /app
# 上传文件目录（演示版本地存储；compose 挂 named volume 持久化）
RUN mkdir -p /data/uploads && chown -R app:app /data
ENV UPLOAD_DIR=/data/uploads
USER app
WORKDIR /app/apps/api
EXPOSE 3001
# 启动前执行待应用的 migration（prisma 在 dependencies 中）
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]

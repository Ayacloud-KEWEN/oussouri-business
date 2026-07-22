# OUSSOURI API — 生产镜像（monorepo 构建）
# 构建上下文必须是仓库根目录: docker build -f apps/api/Dockerfile .
#
# 三段式：deps（装依赖，最稳定的层，改源码不失效）→ builder（编译 + 裁剪）→ runner（只装成品）。
# 两处关键瘦身：
#   1. 依赖只装 api 及其工作区依赖（`--filter @oussouri/api...`），不再顺带装 web 那套 Next/React；
#      apps/web/package.json 仍需拷入，否则工作区结构与 lockfile 对不上，--frozen-lockfile 会拒绝。
#   2. `pnpm deploy --prod` 产出自包含目录（工作区依赖被摊平进 node_modules，devDeps 剔除），
#      runner 只拷这一份，不再整份搬运构建产物与 pnpm store。
FROM node:22-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @oussouri/api...

FROM deps AS builder
WORKDIR /app
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @oussouri/shared build \
 && pnpm --filter @oussouri/api exec prisma generate \
 && pnpm --filter @oussouri/api build
# 自包含产出：node_modules 仅含生产依赖；随后在该目录内重新 generate，
# 让 Prisma Client 落到 /out 自己的 node_modules 里（deploy 不会带上 builder 的 .prisma）
RUN pnpm --filter @oussouri/api deploy --prod --legacy /out \
 && cd /out && ./node_modules/.bin/prisma generate

FROM node:22-alpine AS runner
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=app:app /out /app
# 上传文件目录（演示版本地存储；compose 挂 named volume 持久化）
RUN mkdir -p /data/uploads && chown -R app:app /data
ENV UPLOAD_DIR=/data/uploads
USER app
EXPOSE 3001
# 启动前执行待应用的 migration。prisma 与 tsx 都在 dependencies 里（--prod 保留）：
# 前者供 migrate deploy，后者供容器内跑 scripts/*.ts（seed 与一次性维护脚本）。
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]

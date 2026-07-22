# Oussouri Caviar HUB — 部署手册（Deployment Guide，现行版）

> 更新：2026-07-05　适用版本：main @ P2.2
> 说明：本文取代 [step-10-deployment.md](step-10-deployment.md)（保留作历史）。主要差异：**GitHub Actions 已按运营决定移除（2026-07-05），发布改为手动流程**；镜像已在本机 Docker 完成构建与运行时验证。

---

## 1. 架构与交付物

```
互联网 → OVH 服务器 (Docker Compose)
  nginx (80/443, TLS/限流/安全头)
   ├─ /            → web  (Next.js standalone, :3000)
   └─ /api/v1/*    → api  (NestJS, :3001, 启动时自动 prisma migrate deploy)
  certbot (每 12h 自动续签)
  postgres (pgvector/pg16, 仅内网)   redis (仅内网)
```

| 文件 | 用途 |
|---|---|
| `apps/api/Dockerfile` / `apps/web/Dockerfile` | 生产镜像（构建上下文 = 仓库根） |
| `infra/docker-compose.prod.yml` | 生产编排（healthcheck 门控、DB 不暴露公网） |
| `infra/nginx/oussouri.conf` | TLS/HSTS/安全头、API 20r/s + 登录 5r/m 限流、WS 升级 |
| `infra/backup/backup.sh` | 每日 pg_dump → OVH S3，保留 30 天 |
| `.env.production.example` | 生产环境变量模板 |
| `.dockerignore` | 防止 node_modules 与本机 .env 进入镜像（安全关键，勿删） |

## 2. 服务器一次性准备（OVH，Ubuntu 24.04）

```bash
curl -fsSL https://get.docker.com | sh && usermod -aG docker $USER
apt install -y awscli git
mkdir -p /opt/oussouri && cd /opt/oussouri
git clone https://github.com/Ayacloud-KEWEN/oussouri-business.git .
cp .env.production.example .env.production && chmod 600 .env.production
# 编辑 .env.production：
#  - JWT_SECRET / PII_ENCRYPTION_KEY / PII_BLIND_INDEX_KEY 各用 `openssl rand -hex 32` 生成
#  - POSTGRES_PASSWORD 强口令，并同步进 DATABASE_URL
#  - STRIPE_SECRET_KEY 必须为真实 sk_live/sk_test（占位值 sk_test_xxx 会被 API 启动校验直接拒绝）
```

DNS：`oussouri.fr` / `www.oussouri.fr` / `oussouri.com` / `www.oussouri.com` A 记录 → 服务器 IP。
防火墙：仅开 22（仅密钥登录）/80/443。

## 3. 镜像构建与发布（手动流程，替代已移除的 CI）

两种方式任选：

**方式 A：服务器上直接构建**（最简单，单节点适用）

```bash
cd /opt/oussouri && git pull --ff-only
docker build -f apps/api/Dockerfile -t oussouri-api:latest .
docker build -f apps/web/Dockerfile -t oussouri-web:latest .
# 将 compose 中 image 改为本地 tag（或 docker compose 用 build: 段），然后：
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d
```

**方式 B：本机构建推送 GHCR**（Windows 开发机已验证可构建）

```powershell
docker login ghcr.io -u Ayacloud-KEWEN        # 用 GitHub PAT (write:packages)
docker build -f apps/api/Dockerfile -t ghcr.io/ayacloud-kewen/oussouri-api:latest .
docker build -f apps/web/Dockerfile -t ghcr.io/ayacloud-kewen/oussouri-web:latest .
docker push ghcr.io/ayacloud-kewen/oussouri-api:latest
docker push ghcr.io/ayacloud-kewen/oussouri-web:latest
# 服务器：docker compose ... pull api web && up -d
```

建议每次发布同时打日期 tag（如 `:2026-07-05`）便于回滚：`docker tag ... && docker push ...`。

**发布前本机检查单**：`pnpm --filter @oussouri/api test`（36 单测）→ 起 API 跑三个冒烟（`smoke.ts` 29 项 / `smoke-p2.ts` 13 项 / `smoke-fulfillment.ts` 17 项）→ 双端 `pnpm build` 通过。

## 4. 首次上线流程

```bash
# 1) TLS 鸡蛋问题：先注释 nginx conf 的 443 server 块，仅留 80
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d nginx
docker compose -f infra/docker-compose.prod.yml run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d oussouri.fr -d www.oussouri.fr -d oussouri.com -d www.oussouri.com \
  --email fdcaptain@gmail.com --agree-tos --no-eff-email
# 2) 恢复 443 块，全量启动（api 会自动执行 migrate deploy）
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d
# 3) 种子数据（一次）
docker compose -f infra/docker-compose.prod.yml exec api pnpm prisma:seed
# 4) 创建超管：前台注册一个账号后，DB 赋角色：
docker compose -f infra/docker-compose.prod.yml exec postgres psql -U oussouri -d oussouri -c \
  "INSERT INTO core.user_roles (id, \"userId\", \"roleId\") SELECT gen_random_uuid(), u.id, r.id FROM core.users u, core.roles r WHERE u.\"emailBidx\"='<注册邮箱的盲索引>' AND r.code IN ('ADMIN','SUPER_ADMIN');"
#    盲索引获取：开发机 node -e 用 PII_BLIND_INDEX_KEY 对邮箱做 HMAC（见 apps/api/scripts/smoke.ts 的 bidx 函数）
```

**验收**：`curl https://oussouri.fr/api/v1/health` → `{"status":"ok","db":"up"}`；三语首页可开；注册→审核→下单支付链路走一遍（Stripe 测试卡）。

## 5. 外部服务配置

| 服务 | 配置 |
|---|---|
| Stripe | Dashboard → Webhooks → `https://oussouri.fr/api/v1/webhooks/stripe`，事件 `payment_intent.succeeded`；签名密钥填 `STRIPE_WEBHOOK_SECRET`。供应商 Connect Onboarding 为 P2 待接（当前分账目标为占位账户） |
| OVH S3 | 建三桶：`oussouri-private`（单证原件，禁公共读）/ `oussouri-public`（产品图，可挂 CDN）/ `oussouri-backup` |
| SMTP | 任一 ESP，配 SPF/DKIM/DMARC；填 `SMTP_URL`（邮件通道 P2 待接，当前站内信可用） |
| DeepSeek / OpenAI / Twilio | 填入对应 key（AI 与外呼功能上线时启用；出站内容已有脱敏层设计） |

## 6. 备份与恢复

```bash
chmod +x infra/backup/backup.sh
crontab -e   # 每日 03:15 UTC：
# 15 3 * * * cd /opt/oussouri && POSTGRES_USER=oussouri POSTGRES_DB=oussouri S3_ENDPOINT=https://s3.gra.io.cloud.ovh.net S3_BUCKET_BACKUP=oussouri-backup AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... ./infra/backup/backup.sh >> /var/log/oussouri-backup.log 2>&1
```

恢复（RTO 目标 ≤4h，建议每季度演练）：

```bash
aws s3 cp s3://oussouri-backup/pg/<STAMP>.sql.gz . --endpoint-url $S3_ENDPOINT
gunzip -c <STAMP>.sql.gz | docker compose -f infra/docker-compose.prod.yml exec -T postgres psql -U oussouri -d oussouri
docker compose -f infra/docker-compose.prod.yml restart api
```

## 7. 日常运维

- **看状态**：`docker compose -f infra/docker-compose.prod.yml ps`（api 带 healthcheck，异常自动重启）
- **看日志**：`docker compose ... logs -f api --tail 200`；冷链超阈/穿透申请等关键事件在审计表 `audit.audit_logs`
- **回滚**：`docker compose ... up -d` 指定上一个日期 tag 的镜像；migration 不自动回滚——破坏性 schema 变更需先出恢复方案再发布
- **升级依赖/schema**：开发机验证（migrate dev + 三冒烟）→ 提交 → 服务器 pull + 重建镜像（migrate deploy 自动执行）

## 8. 上线安全检查单

- [ ] `.env.production` 密钥均为随机 64-hex；文件权限 600；绝不提交 git
- [ ] Postgres/Redis 无公网端口映射（compose 默认已是）
- [ ] SSH 禁密码登录；fail2ban 可选
- [ ] Stripe webhook 签名验证生效（生产用 RestStripeAdapter，占位密钥启动即失败）
- [ ] S3 私有桶策略确认禁公共读
- [ ] 备份 cron 已跑通且做过一次恢复演练
- [ ] GDPR：隐私政策/Cookie 同意页（前端待办，上线前补）
- [ ] 冒烟走查：注册审核→上架→下单→支付→发货守卫（故意缺单证验证 409）→清关→签收分账

## 9. 已知限制

- API 镜像为全工作区拷贝（≈1.5GB），瘦身（pnpm deploy）列 P2 优化
- 单节点无 HA；扩展路径见 [step-03 架构 §7](step-03-architecture-design.md)
- CI 已移除：恢复时从 git 历史找回 `.github/workflows/`（提交 `733e451` 前）

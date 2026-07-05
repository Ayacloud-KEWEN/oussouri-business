# OUSSOURI — Step 10 部署（OVH 运维手册）

> 版本：V1.0　日期：2026-07-05
> 目标环境：OVH 法国机房（决策 D5，GDPR 欧盟驻留）

---

## 1. 交付物清单

| 文件 | 用途 |
|---|---|
| [apps/api/Dockerfile](../apps/api/Dockerfile) | API 镜像（启动时自动 `prisma migrate deploy`） |
| [apps/web/Dockerfile](../apps/web/Dockerfile) | Web 镜像（Next standalone，体积小） |
| [infra/docker-compose.prod.yml](../infra/docker-compose.prod.yml) | 生产编排：nginx + certbot + web + api + pgvector/pg16 + redis |
| [infra/nginx/oussouri.conf](../infra/nginx/oussouri.conf) | TLS、HSTS、安全头、API/登录双层限流、WS 升级 |
| [infra/backup/backup.sh](../infra/backup/backup.sh) | 每日 pg_dump → OVH S3，保留 30 天 |
| [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) | 打 tag（v*）→ 构建推送 GHCR 镜像 → SSH 滚动部署 |
| [.env.production.example](../.env.production.example) | 生产环境变量模板 |

## 2. 服务器准备（一次性）

推荐 OVH VPS/Dedicated：**8C/32G/NVMe 起步**（Phase 1 单节点足够，扩展路径见 Step 3 §7）。

```bash
# Ubuntu 24.04
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER
apt install -y awscli git
mkdir -p /opt/oussouri && cd /opt/oussouri
git clone https://github.com/Ayacloud-KEWEN/oussouri-business.git .
cp .env.production.example .env.production
# 编辑 .env.production：openssl rand -hex 32 生成三个密钥；填 Stripe/DeepSeek/S3 真实凭据
```

## 3. DNS

`oussouri.fr`、`www.oussouri.fr`、`oussouri.com`、`www.oussouri.com` 全部 A 记录指向服务器 IP。

## 4. 首次启动与 TLS 签发（鸡蛋问题处理）

nginx 配置引用证书，但首次没有证书。流程：

```bash
# 1) 临时注释 oussouri.conf 中整个 443 server 块，仅留 80（含 acme-challenge）
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d nginx
# 2) 签发（-d 按需增删域名）
docker compose -f infra/docker-compose.prod.yml run --rm certbot certonly \
  --webroot -w /var/www/certbot -d oussouri.fr -d www.oussouri.fr -d oussouri.com -d www.oussouri.com \
  --email fdcaptain@gmail.com --agree-tos --no-eff-email
# 3) 恢复 443 块，全量启动
docker compose -f infra/docker-compose.prod.yml --env-file .env.production up -d
```

certbot 容器每 12h 自动 renew；nginx 每次部署重启即加载新证书。

## 5. 首次数据初始化

```bash
# migrate 在 api 容器启动时自动执行；seed 手动跑一次：
docker compose -f infra/docker-compose.prod.yml exec api pnpm prisma:seed
# 创建超管：先通过 /register 注册一个账号，然后在 DB 中赋 SUPER_ADMIN/ADMIN 角色
# （P2 交付 admin CLI；当前用 psql: INSERT INTO core.user_roles ...）
```

验证：`curl https://oussouri.fr/api/v1/health` → `{"status":"ok","db":"up"}`；浏览器打开三语首页。

## 6. 备份与恢复

```bash
chmod +x infra/backup/backup.sh
crontab -e   # 添加（每日 03:15 UTC）：
# 15 3 * * * cd /opt/oussouri && POSTGRES_USER=oussouri POSTGRES_DB=oussouri S3_ENDPOINT=... S3_BUCKET_BACKUP=oussouri-backup AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... ./infra/backup/backup.sh >> /var/log/oussouri-backup.log 2>&1
```

恢复演练（RTO ≤ 4h 承诺，建议每季度演练一次）：

```bash
aws s3 cp s3://oussouri-backup/pg/<STAMP>.sql.gz . --endpoint-url $S3_ENDPOINT
gunzip -c <STAMP>.sql.gz | docker compose -f infra/docker-compose.prod.yml exec -T postgres psql -U oussouri -d oussouri
```

## 7. 发布流程（CI/CD）

1. 合入 `main`（CI 自动跑 typecheck + 单测 + 双端构建）；
2. 发版：`git tag v0.1.0 && git push --tags` → Deploy 工作流构建镜像推 GHCR → SSH 到 OVH `compose pull && up -d`（API 有 healthcheck，nginx 依赖健康后才转发）；
3. 回滚：`docker compose ... pull api web` 指定上一个 `:SHA` tag，或服务器上 `docker compose up -d --no-deps api=ghcr.io/...:<旧SHA>`。

需在 GitHub 仓库配置 Secrets：`OVH_HOST`、`OVH_USER`、`OVH_SSH_KEY`（部署专用密钥），并创建 `production` environment（可加人工审批门禁）。

## 8. 安全与合规检查单（上线前）

- [ ] `.env.production` 三个密钥均为随机 64-hex，Stripe 为 live key，占位值会被 API 启动校验拒绝
- [ ] Postgres/Redis 未暴露公网端口（compose 仅 expose 内网）
- [ ] 服务器防火墙仅开 22/80/443；SSH 仅密钥登录
- [ ] Stripe Dashboard 配置 webhook → `https://oussouri.fr/api/v1/webhooks/stripe`，密钥填入 env
- [ ] OVH S3 私有桶（单证原件）关闭公共读取
- [ ] GDPR：隐私政策页面、Cookie 同意（前端 P2 待办）；数据全部驻留 OVH FR
- [ ] 备份 cron 已配置且第一次备份验证可恢复

## 9. 监控（P1 最小集）

- `docker compose ps` + api healthcheck（异常自动重启，`restart: always`）
- OVH 监控告警（CPU/磁盘）；日志 `docker compose logs -f api`
- P2 引入：Sentry（自托管）、Uptime 外部探活、账本日终对账告警

## 10. 已知限制与 P2 部署待办

- API 镜像为全工作区拷贝（约 1.5GB），P2 用 `pnpm deploy` 瘦身
- 单节点无高可用；扩展路径：web/api/worker 分机 → PG 主从 → 按限界上下文拆分（Step 3 §7）
- Cloud Panel：如需图形化管理，可在 OVH 上装 CloudPanel/Coolify 接管 compose，本手册以原生 compose 为准

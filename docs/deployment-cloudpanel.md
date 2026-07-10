# Oussouri Caviar HUB — CloudPanel VPS 部署上线操作手册

> 更新：2026-07-09（按实际部署经验修订）　适用：OVH VPS + CloudPanel（与其他网站共存）+ 人工测试阶段
> **实际部署环境**：VPS `vps-2be17ecb`（8G 内存），站点目录 `/home/oussouri/htdocs/www.oussouri.com`，域名 `www.oussouri.com`

---

## 0. 方案说明

CloudPanel 自带 Nginx 并占用 80/443，因此：

- **不启动**仓库自带的 nginx/certbot 容器，使用专用编排 [infra/docker-compose.cloudpanel.yml](../infra/docker-compose.cloudpanel.yml)；
- 应用只监听本机回环地址：Web `127.0.0.1:3100`、API `127.0.0.1:3101`、Postgres `127.0.0.1:5438`（外网不可达，已实测 J3 用例）；
- CloudPanel 站点反代到 3100，vhost 中 `/api/v1/` 段转发到 3101；
- TLS 用 CloudPanel 内置 Let's Encrypt 签发。

**测试阶段支付**：`.env.production` 设 `NODE_ENV=development` + Stripe 占位密钥 → 假支付适配器，买家点"支付"即模拟成功。切正式收款见 §9。

**约定**：下文 `$SITE` 均指 `/home/oussouri/htdocs/www.oussouri.com`。可先执行：

```bash
export SITE=/home/oussouri/htdocs/www.oussouri.com
```

## 1. 前置检查（SSH 后 `sudo su` 或全程 sudo）

```bash
docker -v                 # 已装 29.x ✓
docker compose version    # 已装 v5.x ✓
free -h && df -h /        # 实测 7.6G 内存 / 52G 可用磁盘 ✓
apt install -y iproute2 2>/dev/null; ss -tlnp | grep -E ':(3100|3101|5438)\b' || echo "端口空闲"
```

## 2. 获取代码与配置

站点已在 CloudPanel 创建（目录属主为站点用户 `oussouri`）。仓库为**公开**，克隆无需令牌：

```bash
cd $SITE
# 目录非空（CloudPanel 默认文件）先清空：
rm -rf ./{*,.[!.]*} 2>/dev/null
git clone https://github.com/Ayacloud-KEWEN/oussouri-business.git .
chown -R oussouri:oussouri .

# root 操作他人属主仓库需加白名单（否则 git pull 报 dubious ownership）：
git config --global --add safe.directory $SITE

cp .env.production.example .env.production
chmod 600 .env.production && chown oussouri:oussouri .env.production
nano .env.production
```

`.env.production` 按下表修改（**测试阶段配置**）：

| 变量 | 值 |
|---|---|
| `NODE_ENV` | `development`（测试阶段；启用假支付/假外呼） |
| `WEB_URL` | `https://www.oussouri.com` |
| `POSTGRES_PASSWORD` | 强口令，并同步替换 `DATABASE_URL` 中的口令 |
| `DATABASE_URL` | `postgresql://oussouri:<口令>@postgres:5432/oussouri?schema=core`（主机必须是 `postgres`） |
| `REDIS_URL` | `redis://redis:6379` |
| `JWT_SECRET` / `PII_ENCRYPTION_KEY` / `PII_BLIND_INDEX_KEY` | 各执行 `openssl rand -hex 32` 生成（**PII 两个密钥一旦入库不可再换**，立即备份到密码管理器） |
| 其余（Stripe/DeepSeek/Twilio/S3/SMTP） | 保持占位值（自动走假适配器） |

## 3. 构建镜像并启动

```bash
cd $SITE
docker build -f apps/api/Dockerfile -t oussouri-api:latest .
docker build -f apps/web/Dockerfile -t oussouri-web:latest .
docker compose -f infra/docker-compose.cloudpanel.yml --env-file .env.production up -d
docker compose -f infra/docker-compose.cloudpanel.yml ps          # api 应 healthy
curl -s http://127.0.0.1:3101/v1/health                           # {"status":"ok","db":"up"}
curl -sI http://127.0.0.1:3100 | head -1                          # HTTP 200/307
```

> API 启动时自动执行 migration；api 重启循环时看日志 `... logs api --tail 50`（常见：密钥格式不对、DATABASE_URL 主机写成 localhost）。

## 4. 灌入种子数据（一次）

```bash
docker compose -f infra/docker-compose.cloudpanel.yml exec api pnpm prisma:seed
```

## 5. CloudPanel 反代与 TLS

站点类型两种情况：

- **Reverse Proxy 站点**：Proxy Url 填 `http://127.0.0.1:3100`；
- **已建成 PHP/Static 站点**：进 Vhost 编辑器，把 `location /` 内静态/PHP 处理替换为 `proxy_pass http://127.0.0.1:3100;` 加下方同款 proxy 头。

无论哪种，都在 `location /` **之前**插入 API 段后 Save：

```nginx
  location /api/v1/ {
    proxy_pass http://127.0.0.1:3101/v1/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    client_max_body_size 20m;
  }
```

TLS：站点 → SSL/TLS → New Let's Encrypt Certificate。多域名在 Domain 设置加别名后重签。

验证：`https://www.oussouri.com`（深蓝门户，三语可切）；`/api/v1/health` 返回 `db: up`；页头有"使用指南"入口。

## 6. 创建平台内部账号

前台注册一个账号作为超管载体，然后：

```bash
# ① 计算注册邮箱的盲索引（替换 <你的邮箱>）：
docker compose -f infra/docker-compose.cloudpanel.yml exec api node -e "
const {createHmac}=require('crypto');
console.log(createHmac('sha256', Buffer.from(process.env.PII_BLIND_INDEX_KEY,'hex')).update('<你的邮箱>'.trim().toLowerCase()).digest('hex'));"

# ② 用输出替换 <BIDX>，一次赋全部内部角色：
docker compose -f infra/docker-compose.cloudpanel.yml exec postgres psql -U oussouri -d oussouri -c "
INSERT INTO core.user_roles (id, \"userId\", \"roleId\", \"createdAt\", version)
SELECT gen_random_uuid(), u.id, r.id, now(), 0
FROM core.users u, core.roles r
WHERE u.\"emailBidx\"='<BIDX>' AND r.code IN ('ADMIN','SUPER_ADMIN','FINANCE','BROKER','CUSTOMS_OFFICER','QUALITY_INSPECTOR')
ON CONFLICT DO NOTHING;"
```

重新登录后顶栏出现"管理后台/居间作业台"。测试手册的角色账号同法创建（可分账号分角色）。

## 7. 备份

```bash
mkdir -p $SITE/backups
crontab -e   # 每日 03:15，本地保留 14 天：
# 15 3 * * * docker compose -f /home/oussouri/htdocs/www.oussouri.com/infra/docker-compose.cloudpanel.yml exec -T postgres pg_dump -U oussouri oussouri | gzip > /home/oussouri/htdocs/www.oussouri.com/backups/$(date +\%Y\%m\%d).sql.gz && find /home/oussouri/htdocs/www.oussouri.com/backups -mtime +14 -delete
```

## 8. 日常操作速查

| 操作 | 命令（均在 `$SITE` 下） |
|---|---|
| 看状态 | `docker compose -f infra/docker-compose.cloudpanel.yml ps` |
| 看 API 日志 | `... logs -f api --tail 100` |
| 重启 | `... restart api web` |
| **升级到最新代码** | `git pull --ff-only`（**确认输出有新提交再继续**，否则 build 全是缓存等于没更新）→ `docker build -f apps/api/Dockerfile -t oussouri-api:latest .` → `docker build -f apps/web/Dockerfile -t oussouri-web:latest .` → `docker compose -f infra/docker-compose.cloudpanel.yml --env-file .env.production up -d` |
| 只更新前端 | pull 后仅 build web 镜像 + `up -d web` |
| 回滚 | 升级前 `docker tag oussouri-api:latest oussouri-api:prev`（web 同理）；出问题把 compose 中 image 改 `:prev` 后 `up -d` |
| 停止（不删数据） | `... down`（数据在 named volume `oussouri_pgdata`） |

## 9. 从"人工测试"切换到"正式收款"检查单

- [ ] `NODE_ENV=production`；`STRIPE_SECRET_KEY` 真实密钥（占位密钥会拒绝启动——故意的保险丝）
- [ ] Stripe Dashboard 配 webhook `https://www.oussouri.com/api/v1/webhooks/stripe`（`payment_intent.succeeded`），签名密钥填 `STRIPE_WEBHOOK_SECRET`
- [ ] 前台接入 Stripe Elements 收银台 + 供应商 Connect 入驻（开发路标 R1，见 development-guide.md §9）
- [ ] 清理测试数据或整库重建后重新 seed
- [ ] SMTP/S3/DeepSeek/Twilio 按需填真实凭据
- [ ] 重建镜像 `up -d`，重跑测试手册 A/B/D/E 组

## 10. 故障排查（含实战案例）

| 现象 | 排查/处置 |
|---|---|
| `git pull` 报 **dubious ownership** | `git config --global --add safe.directory $SITE`（root 操作站点用户属主仓库的正常现象） |
| `up -d` 报 **container's cgroup is not empty** | runc 残留进程故障（实战遇到过）：`... down` 后重新 `up -d`；无效则 `systemctl restart docker`（会短暂重启本机全部容器，选低峰执行）后再 `up -d` |
| build 飞快全是 "Using cache" | 上一步 `git pull` 失败了没拉到新代码——先解决 pull 再 build |
| 域名 502 | `curl 127.0.0.1:3100` 不通看 web 日志；通则查 vhost 端口 |
| `/api/v1` 404 | vhost 的 `location /api/v1/` 缺失或排在 `location /` 之后 |
| api unhealthy | `logs api`：env 校验失败 / DATABASE_URL 主机应为 `postgres` |
| 撮合看板空 | 正常，需先造"流失买家/开放 RFQ × 匹配库存"数据；作业台可手动"运行撮合" |
| 磁盘增长快 | `docker system prune -f`；备份轮转是否生效 |
| 页面样式没更新 | 浏览器强刷 Ctrl+F5；确认 web 镜像重建于 pull 之后 |
| 静态图片 404（本地正常） | Next standalone 产物**不含 public/ 目录**，Web Dockerfile 已单独 COPY（cbb045b 修复）；新增 public 资源后只需重建 web 镜像。验证：`curl -sI http://127.0.0.1:3100/origins/heilongjiang.webp` 应 200 |

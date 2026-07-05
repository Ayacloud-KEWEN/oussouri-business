# Oussouri Caviar HUB — CloudPanel VPS 部署上线操作手册

> 更新：2026-07-05　适用：OVH VPS + CloudPanel（与其他网站共存）+ 人工测试阶段
> 预计耗时：首次 60–90 分钟

---

## 0. 方案说明（为什么与独占服务器不同）

CloudPanel 自带 Nginx 并占用 80/443，因此：

- **不启动**仓库自带的 nginx/certbot 容器，改用专用编排 [infra/docker-compose.cloudpanel.yml](../infra/docker-compose.cloudpanel.yml)；
- 应用只监听本机回环地址：Web `127.0.0.1:3100`、API `127.0.0.1:3101`、Postgres `127.0.0.1:5438`（外网不可达）；
- 在 CloudPanel 建一个 **Reverse Proxy 站点** 指向 3100，并在 vhost 里加一段 `/api/v1/` 转发到 3101；
- TLS 证书用 CloudPanel 内置的 Let's Encrypt 一键签发。

**人工测试阶段的支付说明**：`.env.production` 中 `NODE_ENV=development` + Stripe 占位密钥 → 自动启用假支付适配器，买家点"支付"即模拟成功，无需真实银行卡。正式收款前改 `NODE_ENV=production` + 真实密钥（见 §9）。

## 1. 前置检查（SSH 到 VPS）

```bash
docker -v || curl -fsSL https://get.docker.com | sh     # 无 Docker 则安装
docker compose version                                   # 需 v2
free -h && df -h /                                       # 建议：可用内存 ≥3GB、磁盘 ≥15GB
ss -tlnp | grep -E ':(3100|3101|5438)\b' || echo "端口空闲"   # 冲突则改 compose 中的宿主端口
```

## 2. 获取代码与配置

```bash
sudo mkdir -p /opt/oussouri && sudo chown $USER /opt/oussouri && cd /opt/oussouri
git clone https://github.com/Ayacloud-KEWEN/oussouri-business.git .
cp .env.production.example .env.production && chmod 600 .env.production
nano .env.production
```

`.env.production` 按下表修改（**测试阶段配置**）：

| 变量 | 值 |
|---|---|
| `NODE_ENV` | `development`（测试阶段；启用假支付） |
| `WEB_URL` | `https://你的域名`（如 `https://oussouri.fr`） |
| `POSTGRES_PASSWORD` | 强口令，并同步替换 `DATABASE_URL` 中的口令 |
| `DATABASE_URL` | `postgresql://oussouri:<口令>@postgres:5432/oussouri?schema=core`（注意主机是 `postgres` 不是 localhost） |
| `REDIS_URL` | `redis://redis:6379` |
| `JWT_SECRET` / `PII_ENCRYPTION_KEY` / `PII_BLIND_INDEX_KEY` | 各执行一次 `openssl rand -hex 32` 生成（**PII 两个密钥一旦入库数据就不可再换**，请立即抄写备份到密码管理器） |
| 其余（Stripe/DeepSeek/Twilio/S3/SMTP） | 保持占位值即可（自动走假适配器） |

## 3. 构建镜像并启动

```bash
cd /opt/oussouri
docker build -f apps/api/Dockerfile -t oussouri-api:latest .     # 约 3-6 分钟
docker build -f apps/web/Dockerfile -t oussouri-web:latest .     # 约 3-6 分钟
docker compose -f infra/docker-compose.cloudpanel.yml --env-file .env.production up -d
docker compose -f infra/docker-compose.cloudpanel.yml ps          # api 应显示 healthy
curl -s http://127.0.0.1:3101/v1/health                           # {"status":"ok","db":"up"}
curl -sI http://127.0.0.1:3100 | head -1                          # HTTP 200/307
```

> API 容器启动时自动执行数据库 migration；若 `ps` 显示 api 重启循环，看日志：
> `docker compose -f infra/docker-compose.cloudpanel.yml logs api --tail 50`（常见原因：env 密钥格式不对、DATABASE_URL 主机写成了 localhost）。

## 4. 灌入种子数据（一次）

```bash
docker compose -f infra/docker-compose.cloudpanel.yml exec api pnpm prisma:seed
```

种子含：11 角色、17 品种（三语）、等级、国家/汇率、6 个状态机、单证 7 件套模板、佣金规则、编码规则。

## 5. CloudPanel 建站与反代

1. CloudPanel → **Sites → Add Site → Create a Reverse Proxy**：
   - Domain Name: `oussouri.fr`（或你的测试域名，DNS A 记录先指到本 VPS）
   - Reverse Proxy Url: `http://127.0.0.1:3100`
   - 创建站点用户（随意）。
2. 站点 → **SSL/TLS → Actions → New Let's Encrypt Certificate** → 勾选域名 → Create（DNS 生效后一键签发）。
3. 站点 → **Vhost** 编辑器，在 `location / { ... }` 块 **之前** 插入 API 转发段后 Save：

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

4. 验证：浏览器打开 `https://你的域名`（应见深蓝门户首页，中/EN/FR 可切换）；`https://你的域名/api/v1/health` 返回 `db: up`。

> 多域名（oussouri.com 等）：在同一站点的 Domain 设置里添加别名并重新签证书即可。

## 6. 创建平台内部账号

前台 `https://域名/zh-CN/register` 先注册一个账号（任选供应商类型，作为你的超管载体），然后 SSH 赋角色：

```bash
# 计算注册邮箱的盲索引（在 VPS 上执行，替换邮箱与 .env.production 中的 PII_BLIND_INDEX_KEY）
docker compose -f infra/docker-compose.cloudpanel.yml exec api node -e "
const {createHmac}=require('crypto');
console.log(createHmac('sha256', Buffer.from(process.env.PII_BLIND_INDEX_KEY,'hex')).update('你的邮箱@example.com'.trim().toLowerCase()).digest('hex'));"

# 用上一步输出替换 <BIDX>，赋 超管+管理员+财务：
docker compose -f infra/docker-compose.cloudpanel.yml exec postgres psql -U oussouri -d oussouri -c "
INSERT INTO core.user_roles (id, \"userId\", \"roleId\", \"createdAt\", version)
SELECT gen_random_uuid(), u.id, r.id, now(), 0
FROM core.users u, core.roles r
WHERE u.\"emailBidx\"='<BIDX>' AND r.code IN ('ADMIN','SUPER_ADMIN','FINANCE','BROKER','CUSTOMS_OFFICER','QUALITY_INSPECTOR')
ON CONFLICT DO NOTHING;"
```

重新登录后顶栏出现"管理后台/居间作业台"。测试用例手册（§下一份文档）需要的四类角色账号也用此法创建。

## 7. 备份（测试阶段也建议开启）

```bash
crontab -e   # 每日 03:15，本地保留 14 天（S3 版见 infra/backup/backup.sh）
# 15 3 * * * docker compose -f /opt/oussouri/infra/docker-compose.cloudpanel.yml exec -T postgres pg_dump -U oussouri oussouri | gzip > /opt/oussouri/backups/$(date +\%Y\%m\%d).sql.gz && find /opt/oussouri/backups -mtime +14 -delete
mkdir -p /opt/oussouri/backups
```

## 8. 日常操作速查

| 操作 | 命令 |
|---|---|
| 看状态 | `docker compose -f infra/docker-compose.cloudpanel.yml ps` |
| 看 API 日志 | `... logs -f api --tail 100` |
| 重启 | `... restart api web` |
| **升级到最新代码** | `cd /opt/oussouri && git pull --ff-only && docker build -f apps/api/Dockerfile -t oussouri-api:latest . && docker build -f apps/web/Dockerfile -t oussouri-web:latest . && docker compose -f infra/docker-compose.cloudpanel.yml --env-file .env.production up -d` |
| 回滚 | 升级前 `docker tag oussouri-api:latest oussouri-api:prev`（web 同理）；出问题改 compose image 为 `:prev` 后 `up -d` |
| 停止（不删数据） | `... down`（数据在 named volume `oussouri_pgdata` 中） |

## 9. 从"人工测试"切换到"正式收款"检查单

- [ ] `.env.production`：`NODE_ENV=production`；`STRIPE_SECRET_KEY` 填真实密钥（假密钥会拒绝启动——这是故意的保险丝）
- [ ] Stripe Dashboard 配置 webhook `https://域名/api/v1/webhooks/stripe`（事件 `payment_intent.succeeded`），`STRIPE_WEBHOOK_SECRET` 填对应签名密钥
- [ ] 前台买家支付需接入 Stripe Elements 收银台（当前测试版为模拟支付按钮，正式版开发项）
- [ ] 数据库清理测试数据或整库重建后重新 seed
- [ ] SMTP/S3/DeepSeek/Twilio 按需填真实凭据
- [ ] 重建镜像并 `up -d`，重跑测试手册的 A/B/C 三套核心用例

## 10. 故障排查

| 现象 | 排查 |
|---|---|
| 域名 502 | `curl 127.0.0.1:3100` 是否通 → 不通看 web 容器日志；通则检查 CloudPanel vhost 端口写对没 |
| /api/v1 404 | vhost 的 `location /api/v1/` 段没加或顺序在 `location /` 之后 |
| api 容器 unhealthy | `logs api`：env 校验失败（密钥格式）/ DB 连不上（DATABASE_URL 主机应为 `postgres`） |
| 登录报错但 health 正常 | JWT_SECRET 是否 ≥32 字符；浏览器控制台看具体错误码 |
| 撮合看板空 | 正常——需先按测试手册 E 组用例造出"流失买家/开放 RFQ × 匹配库存"的数据 |
| 磁盘增长快 | `docker system prune -f` 清理旧镜像层；备份目录轮转是否生效 |

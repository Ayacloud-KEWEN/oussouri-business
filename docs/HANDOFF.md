# HANDOFF — 新会话接续开发指南

> 更新：2026-07-16（每次大批次交付后更新本文件）
> 用途：在新的 Claude 会话/新开发者接手时，读完本文即可继续开发，无需翻聊天记录。

---

## 1. 一句话现状

**Oussouri Caviar HUB**（居间控制型中欧鱼子酱 B2B 平台，oussouri.fr/.com）：P1 交易闭环 + P2 全部五批（撮合/居间代下单/RFQ/履约/脱敏发单/溯源/外呼）+ 演示批次（GDPR/实时行情/产品图片/省份图/一键演示数据）已完成，**已部署在用户 OVH VPS（CloudPanel）供人工测试与投资人演示**。**R2 全部完成**（账号安全批：忘记/修改密码 + httpOnly cookie 会话 + TOTP 2FA；实时与搜索批：WS 通知推送 + 全文搜索；翻译管道：DeepSeek 机翻→人工复核；后台与风控批：可见性策略拦截器 + 主体名录 + 佣金配置/风控看板/审计检索）。**HZB 真实案例已入库**（本地 + VPS），**R1.5-5 外贸学院 / R1.5-6 首页数据真实化已交付**。下一步 R1（真实收款）+ R1.5 剩余项（分期付款/框架合同/CITES 多物种行/样品单）。

## 2. 必读文档（按此顺序）

1. [development-guide.md](development-guide.md) —— **先读这个**：三条商业底线、模块边界纪律、六条开发约定（状态机/编码/PII/资金/库存/i18n）、踩坑清单、§9 路标 R1–R4
2. [deployment-cloudpanel.md](deployment-cloudpanel.md) —— 现行生产环境（VPS 路径/端口/升级口诀/故障表）
3. [step-02-requirements-specification.md](step-02-requirements-specification.md) —— 需要查某功能业务规则时按 FR/BR 编号检索
4. [manual-test-cases.md](manual-test-cases.md) / [demo-preparation.md](demo-preparation.md) / [operations-manual.md](operations-manual.md) —— 按需

## 3. 环境速查

**本机开发**（Windows，本仓库在 OneDrive 目录）：

```powershell
docker compose -f infra/docker-compose.dev.yml up -d   # PG :5437 / Redis :6381（5432/6379 被本机其他项目占用）
cd apps/api ; pnpm dev        # API :3001（.env 已配好，勿用 PowerShell Set-Content 改 UTF-8 文件！）
pnpm --filter @oussouri/web dev   # Web :3000
# 预览用 .claude/launch.json（api/web 两个配置）；Docker Desktop 经常自己停，命令报 npipe 错误就先拉起它
```

**VPS 生产**：`ssh ubuntu@51.210.7.13` → `/home/oussouri/htdocs/www.oussouri.com`；升级口诀 **pull → build×2 → up --force-recreate**（详见部署手册 §8，用户常忘 build 或 Ctrl+C 打断，注意提醒）。

**测试账号**（本地与 VPS 演示库均由 `scripts/seed-demo.ts` 创建，密码 `Demo2026!Caviar`）：
`demo-ops@oussouri.local`（全部内部角色）/ `supplier-a|b@demo.oussouri` / `buyer-a|b@demo.oussouri`。
本地另有 `admin@oussouri.local / AdminDev2026!!`、`broker@oussouri.local / BrokerDev2026!!`、`customs@oussouri.local / CustomsDev2026!!`（各冒烟脚本自动创建）。

## 4. 提交前硬性检查（历来如此，勿降级）

```powershell
pnpm --filter @oussouri/api typecheck ; pnpm --filter @oussouri/web typecheck
pnpm --filter @oussouri/api test          # 32 单测
# 起 API 后按改动范围重跑冒烟（apps/api/scripts/）：
# smoke.ts(29) smoke-p2.ts(13) smoke-fulfillment.ts(17) smoke-p2x.ts(17)
pnpm --filter @oussouri/web build
# 涉静态资源/Docker 的改动：构建生产镜像 docker run 验证（standalone ≠ dev server）
```

提交信息英文、结尾 Co-Authored-By（见 git log 惯例）；**多行提交信息用 `git commit -F 文件`**（PowerShell 内嵌引号会炸）；推送 origin main（仓库公开：github.com/Ayacloud-KEWEN/oussouri-business）。

## 5. 下一步

**R2 已交付（2026-07-11，本地已提交）**：
- 忘记/修改密码（PasswordResetToken 一次性令牌 + MailPort 日志适配器，SMTP 等 R1-4）
- httpOnly cookie 会话（`oussouri_at`/`oussouri_rt`；Guard 兼容 Bearer 头，冒烟脚本不受影响；前端 401 自动刷新一次）
- 内部角色 TOTP 2FA（零依赖 RFC 6238 实现 `iam/totp.ts`，登录挑战 5 分钟票据；绑定需首码验证；/account 页管理）
- WS 实时通知（`notification.gateway.ts` 挂 upgrade 事件于 `/v1/ws`，cookie 或 ?token= 鉴权；header 铃铛红点三语）
- 产品搜索（`/products?q=`：tsvector + trigram + 中文逐词 ILIKE；EmbeddingPort 已留 OpenAI 兼容适配器，配 `EMBEDDING_API_*` 即启 pgvector 语义，DeepSeek 无 embedding API）

**R2 批次 3+4 已交付（2026-07-12）**：
- AI 翻译管道：`modules/i18n/`（LlmPort：DeepSeek 适配器，占位 key 自动降级 Fake；ProductPublished 触发机翻草稿，出站先过 PiiFilter；`/admin/translations` 复核；公开目录 `?locale=` 只露 REVIEWED 译文）
- 可见性策略拦截器：`kernel/visibility/`（表驱动 DENY/MASK，@VisibilityResource 标注启用，60s 缓存；`/admin/visibility-policies` SUPER_ADMIN CRUD）；JwtAuthGuard 公共路由也尽力解析身份
- 管理后台补齐：主体名录（全部供采+分页）｜佣金规则 `/admin/commission-rules`（ADMIN/FINANCE；下单按 priority 匹配、无规则回退 8%）｜PII 拦截看板 `/admin/risk/blocks`｜审计检索 `/admin/audit`（SUPER_ADMIN）
- 注意：本地 `next build` 前必须停 dev server（.next 互写会坏，OneDrive 加剧）

**2026-07-15 批次已交付**：
- **HZB 真实案例入库**：50KG 真实交易（合同 HZBZLH20251008 → 订单 ORD-20260715-00112，COMPLETED）经 `scripts/seed-hzb-case.ts` 幂等导入本地与 VPS；原件 PDF 归档 `uploads/case-docs/HZB/`（HZB/ 目录已 gitignore，含银行信息勿入库）
- **外贸教学文档** docs/caviar-trade-tutorial.md（十步实操 + 平台双侧操作指引，R1.5-5 待上站）
- 修复：目录批发价对 cookie 会话失效（改用 `@CurrentUser()` 判定 + SSR 转发 cookie）；导航按角色路由（RFQ 大厅/首页 CTA）；原产地模块增强（湖南东江湖/云南 + 三语产区介绍 + line-clamp 排版）；首页新增「产业与市场洞察」版块
- **复盘产出 R1.5 批次**（development-guide §9）：分期付款/框架合同/CITES 多物种行/样品单/知识中心/首页数据真实化

**2026-07-16 批次已交付（R1.5-5 / R1.5-6）**：
- **外贸学院**：`/help/academy` 三语学院页（react-markdown + remark-gfm，元素级站点配色映射）；文章内容维护在 `apps/web/content/academy.ts`（追加 ARTICLES 数组即新增文章）；帮助页有入口卡片
- **首页数据真实化**：平台数据带接 `/market/stats`，达阈值（供应商/买家≥50、SKU≥100、成交≥300、国家≥5，见 page.tsx `STATS_LIVE_THRESHOLD`）自动切实时并亮「实时」徽标，否则演示值+「示例数据」；产业洞察经 `GET/PUT /market/portal-config`（ConfigEntry portal/industry-insights，ADMIN 写 + 审计）覆盖，管理后台底部「门户洞察配置」JSON 编辑卡片，浅合并（title/supply/demand/footnote 顶层整体替换），null 恢复默认
- 注意：web 新增依赖 react-markdown/remark-gfm；`.next` 目录被 dev/build 互写弄脏时（EINVAL readlink）删掉 `.next` 重新 build 即可

**下一步 R1（真实收款）**，按 development-guide §9 的 R1 表执行（R1.5 剩余项 -1/-2/-3/-4 可穿插小步交付），建议顺序与要点：

| 项 | 落点提示 |
|---|---|
| R1-1 Stripe Elements 收银台 | 后端 checkout 已返回 clientSecret；前端买家支付改为 Stripe Elements 卡组件；webhook 已有签名验证（RestStripeAdapter）；假适配器逻辑保留供开发 |
| R1-2 Connect 入驻 | `StripeAccount` 表已建；加 onboarding link 生成 + 状态回写；`SettlementService.releaseEscrow` 的 destination 目前是占位 `acct_fake_supplier` |
| R1-3 S3 文件上传 | `files.controller` 换 StoragePort（本地/S3 双适配器，与 Stripe/Telephony 同模式）；密钥在 .env S3_* |
| R1-4 SMTP 邮件 | 通知消费者在 `communication.service`（OnEvent）；加 MailPort + 模板三语渲染（EntityTranslation） |
| R1-5 证书到期扫描 | 仿 `matchmaking.service` 的 @Cron；表索引已备（PartyCertificate.expiryDate / CitesPermit） |
| R1-6 争议 UI | 后端 Dispute 模型 + 资金冻结逻辑已在；缺买家发起与管理员裁决页面 |
| R1-7 GDPR 补齐 | 隐私页/Cookie 横幅已上线；剩数据导出/删除请求工作流 |

## 6. 高频陷阱（新会话最容易踩的）

1. **身份防火墙是底线**：任何新接口输出前过一遍"对手方只能见平台代码"；用户自由文本过 `PiiFilterService`；发往 LLM 的内容必须先脱敏。
2. 状态列禁止直接 UPDATE —— 走 `StateMachineService`；新状态机在 seed 注册迁移表。
3. Prisma 列名是 camelCase（无 @map），raw SQL 写 `"qtyOnHand"` 带引号。
4. 前端文案三语字典同步加（zh-CN/en/fr 三文件），禁止硬编码。
5. Next standalone 不含 public/、rewrites 构建期固化 —— 静态资源改动用生产镜像验证。
6. Windows：不用 PowerShell 改源码文件；Docker Desktop 常掉线先 `docker info` 探活。
7. 用户的沟通语言是中文；对用户的 VPS 操作给完整可粘贴命令并预告耗时（构建被 Ctrl+C 打断过一次）。
8. **VPS 环境与仓库有本地差异**：`.env.production` 里 `API_PORT=3100`（容器内 API 监听 3100 而非 3001，宿主映射 127.0.0.1:3101→3100）；容器内跑脚本用 `-e DEMO_API_BASE=http://127.0.0.1:3100/v1`。
9. 公共接口做登录差异化视图（如批发价）一律用 Guard 解析的 `@CurrentUser()` 判定，兼容 Bearer 与 httpOnly cookie；`launch.json` 的 api 配置跑 `node dist/main.js`，改 API 源码后须 `pnpm --filter @oussouri/api build` 再重启预览。

## 7. 未合并的已知琐碎项

- `docs/demo-preparation.md` §1 表格里有用户手填的测试账号（test01–04@gmail.com），是用户自己的备忘，勿删；
- ~~首页平台数据带待接实时~~ 已解决（2026-07-16）：达阈值自动切换，阈值在 `page.tsx STATS_LIVE_THRESHOLD` 可调；
- CI 已按用户要求移除（恢复参考 git 历史 733e451 之前的 `.github/workflows/`）。

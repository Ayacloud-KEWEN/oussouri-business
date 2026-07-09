# Oussouri Caviar HUB — 开发过程文档（Development Guide）

> 更新：2026-07-09　适用版本：main @ P2 全量完成（已部署 CloudPanel 测试环境）
> 读者：加入项目的开发者 / 外包团队 / 未来的自己

---

## 1. 项目是什么

居间方控制型（Broker-Controlled）的中欧高端食品 B2B 交易平台，首发行业为黑龙江鲟鳇鱼制品（鱼子酱等）。三条商业底线贯穿所有代码：

1. **身份防火墙**：供采双方永远只见平台代码（`SP-000018` / `BY-000256`），真实身份仅平台持有；
2. **全链路托管**：沟通（IM 拦截联系方式）、资金（Stripe Escrow）、单证、物流清关全部经平台；
3. **AI 撮合**：平台主动发现供需商机推送给居间专员（Broker）。

**改代码前必读**：任何 API 响应、通知、导出、AI 输出中出现对方公司名/联系方式 = 事故。

## 2. 设计文档索引（十步工作流产物）

| 文档 | 内容 |
|---|---|
| [step-01-requirements-analysis.md](step-01-requirements-analysis.md) | 需求分析、与初稿差距、三期分期 |
| [step-02-requirements-specification.md](step-02-requirements-specification.md) | **7 条全局业务规则（GBR）+ 22 模块 FR/BR 编号需求**（代码溯源锚点） |
| [step-03-architecture-design.md](step-03-architecture-design.md) | 模块化单体、13 限界上下文、Outbox 事件、Port/Adapter |
| [step-04-database-design.md](step-04-database-design.md) | 约 70 表 Schema 设计与权衡 |
| [step-05-api-design.md](step-05-api-design.md) | REST 约定、端点目录、错误码 |
| [step-06-ui-design.md](step-06-ui-design.md) | 设计令牌、五端信息架构 |
| [step-09-testing.md](step-09-testing.md) | 测试策略与已修缺陷 |
| [step-10-deployment.md](step-10-deployment.md) / [deployment-guide.md](deployment-guide.md) | OVH 独占部署（历史版） |
| [deployment-cloudpanel.md](deployment-cloudpanel.md) | **现行部署手册**（CloudPanel 共存，实际测试环境 `/home/oussouri/htdocs/www.oussouri.com`） |
| [manual-test-cases.md](manual-test-cases.md) | 70 条人工测试用例手册 |
| [operations-manual.md](operations-manual.md) | 平台运营手册 |

## 3. 已确认的关键决策（勿反复讨论）

Stripe Connect（Escrow）｜DeepSeek 默认 LLM（出站必须先脱敏，PII 不出境）｜Twilio 外呼｜OVH 法国部署｜公开编码不含地域信息｜品牌名 Oussouri Caviar HUB｜三期分期（P1 交易闭环 → P2 居间增值 → P3 AI 完全体）。

## 4. 仓库结构与模块边界

```
apps/api        NestJS 模块化单体
  src/kernel/   平台内核（任何模块可依赖）：crypto(PII加密+盲索引) / codegen(编码引擎)
                / audit / outbox(+dispatcher) / state-machine / pii(拦截) / prisma
  src/modules/  业务模块：iam / party / catalog / inventory / trading(+rfq)
                / settlement / communication / brokerage
  prisma/       schema.prisma（70 表）+ migrations + seed
  scripts/      smoke.ts（P1 闭环 29 项）/ smoke-p2.ts（P2 13 项）
apps/web        Next.js 15 App Router，/[locale]/ 三语路由
  messages/     zh-CN / en / fr 文案字典（禁止硬编码文案）
packages/shared 前后端共享常量（角色/币种/状态机/错误码）
infra/          dev 与 prod compose、nginx、备份脚本
docs/           本目录
```

**模块间纪律**（架构 A1）：业务模块之间不 import 对方 service、不查对方表；协作走 kernel 服务或领域事件（Outbox → EventEmitter 消费者）。跨上下文引用在 DB 层是无约束 UUID 列（有意为之）。

## 5. 本地开发环境

```powershell
pnpm install
docker compose -f infra/docker-compose.dev.yml up -d   # PG 5437 / Redis 6381（避开本机其他项目）
cd apps/api
Copy-Item ..\..\.env.example .env    # 然后把三个密钥换成 openssl rand -hex 32
npx prisma migrate dev
pnpm prisma:seed
pnpm dev                              # API :3001，Swagger /docs
# 另开终端
pnpm --filter @oussouri/web dev       # Web :3000（/api/v1 代理到 API）
```

开发账号（冒烟脚本自动创建/幂等）：

| 账号 | 密码 | 角色 |
|---|---|---|
| admin@oussouri.local | AdminDev2026!! | ADMIN + SUPER_ADMIN + FINANCE |
| broker@oussouri.local | BrokerDev2026!! | BROKER |
| 供应商/买家 | 每次冒烟随机生成 | 通过 /register 自建亦可（需管理员审核激活） |

**注意**：Stripe 占位密钥（`sk_test_xxx`）时自动启用假适配器，支付走 `POST /v1/webhooks/stripe` 手动回调模拟；生产占位密钥会拒绝启动。

## 6. 核心开发约定

- **状态迁移**：禁止直接 UPDATE 状态列。走 `StateMachineService.assertAllowed()` + 事务内 `recordInTx()`（审计+事件）。新状态机在 seed 中注册迁移表。
- **公开编码**：一律 `CodeGeneratorService.next(entityType, tx)` 签发；UUID 永不出现在 URL/响应。
- **PII**：加密列 `xxxEnc`（`CryptoService.encrypt`）+ 等值查询用盲索引 `xxxBidx`；对外输出前想一遍可见性；用户自由文本一律过 `PiiFilterService.scan()`。
- **资金**：任何资金状态变化先写 `LedgerEntry` 双分录（同事务），Stripe 为事实源、账本为影子账。
- **库存**：只写 `InventoryTransaction` 流水 + 事务内行锁（`reserveInTx/releaseInTx/outboundInTx`），余额列是缓存，DB CHECK 约束兜底防超卖。
- **i18n**：前端文案进 `messages/*.json` 三语同步加；业务数据翻译走 `EntityTranslation` 表。
- **原生 SQL 列名**：Prisma 字段未 `@map`，实际列为 camelCase，raw SQL 须写 `"qtyOnHand"` 带引号（踩过坑）。
- **Windows 注意**：不要用 PowerShell `Set-Content` 改 UTF-8 源码（会 GBK 乱码）；Next standalone 仅 Docker 内启用（`NEXT_OUTPUT=standalone`）。

## 7. 测试与验证

```powershell
pnpm --filter @oussouri/api test          # 单元 32 用例（crypto/PII/编码/阶梯价/状态机）
# E2E 冒烟（先起 API）：
npx tsx scripts/smoke.ts                  # P1 全闭环 29 项（注册→审核→上架→下单→支付→发货→签收→分账）
npx tsx scripts/smoke-p2.ts               # P2 13 项（RFQ 闭环、撮合、居间代下单、价格底线）
npx tsx scripts/smoke-fulfillment.ts      # 履约 17 项（单证守卫、冷链、清关联动、CITES）
npx tsx scripts/smoke-p2x.ts              # P2.3-2.5 17 项（脱敏发单、溯源守卫、外呼）
```

提交前最低要求：`typecheck` + 单测全绿 + 受影响冒烟脚本重跑。CI 工作流已按用户要求移除（2026-07-05），恢复时参考 git 历史 `.github/workflows/ci.yml`。

## 8. 开发史与已修缺陷（防止回归）

| 阶段 | 提交 | 要点 |
|---|---|---|
| Step 1–6 | docs | 设计六步（需求→UI），用户确认制 |
| Step 7 | a951110/d6865ef | Monorepo + 70 表 + 内核 + 7 模块，冒烟 29 项 |
| Step 8 | 215f5dc | 三语前端 + 三工作台 |
| Step 9 | a5b25f6 | 32 单测；**修复：PHONE 正则误拦订单号**（平台编码先剔除再扫描） |
| Step 10 | 733e451 | OVH 部署栈；**修复：health 401（缺 @Public）**、**.dockerignore 缺失导致 .env 打进镜像**；改名 Oussouri Caviar HUB |
| 门户 | 253e456 | CAVIAR HUB 风格首页（演示数据在 `apps/web/lib/portal-data.ts`） |
| P2 批 1 | 772aa00 | 撮合规则引擎 + 居间代下单 + RFQ 闭环（冒烟 13 项） |
| P2.2 履约 | f73bbee | 多段物流/冷链告警/清关联动/**单证 7 件套发货守卫**/CITES 配额（冒烟 17 项） |
| P2.3-2.5 | 49d9661 | 脱敏发单（追踪码）/ 溯源域 ERP（休药期守卫）/ Twilio 代理外呼（冒烟 17 项） |
| 手册三件套 | c125243 前后 | CloudPanel 部署手册 + 70 条测试用例 + 运营手册 |
| UI 收尾 | 4e5a8f8/c5aa529 | 全站深蓝金主题统一、页头防换行、三语使用指南页 `/help` |
| 已修缺陷 | — | scrypt maxmem；阶梯价 50kg 边界；PHONE 正则误拦订单号；health 401；.env 打入镜像；本机端口冲突改 5437/6381；VPS runc cgroup 残留（down→up 或重启 docker） |

**测试基线**：单测 32 + E2E 冒烟 76 项（29/13/17/17），提交前全绿为硬性要求。
**当前部署**：OVH VPS + CloudPanel，`/home/oussouri/htdocs/www.oussouri.com`，见 [deployment-cloudpanel.md](deployment-cloudpanel.md)。

## 9. 开发路标（Roadmap，2026-07-09 确认）

### R1 正式收款前必备（下一批开发，P2 收尾）

| # | 功能 | 说明 | 现状 |
|---|---|---|---|
| R1-1 | **Stripe Elements 收银台** | 前端真实卡支付组件 + webhook 签名验证联调 | 后端就绪，前端为模拟按钮 |
| R1-2 | **供应商 Stripe Connect 入驻** | KYC onboarding，分账打到供应商真实账户 | 分账目前指向占位账户 |
| R1-3 | **S3 文件真实上传** | OVH S3 预签名直传（单证/产品图）；脱敏 PDF 像素级遮盖渲染依赖此 | 仅元数据登记 |
| R1-4 | **邮件通道（SMTP）** | 审核/支付链接/告警邮件；SPF/DKIM/DMARC | 仅站内信 |
| R1-5 | 证书到期扫描任务 | CITES/SC 临期提醒 + 过期自动下架 | 表/索引就绪，缺 cron |
| R1-6 | 争议处理 UI | 买家发起 + 管理员裁决界面 | 后端与资金冻结逻辑就绪 |
| R1-7 | GDPR 页面 | 隐私政策 + Cookie 同意横幅（欧盟合规硬要求） | 无 |

### R2 体验完善（R1 后按优先级排期）

产品图片上传与展示｜忘记/修改密码｜内部角色 2FA（表已备）｜全文 + pgvector 语义搜索｜AI 翻译管道（DeepSeek 机翻草稿 → 人工复核，`EntityTranslation` 表就绪）｜WebSocket 实时推送（通知/商机红点）｜httpOnly cookie 会话（替代 localStorage）｜可见性策略数据化拦截器（`VisibilityPolicy` 表驱动）｜管理后台补齐（翻译复核队列/佣金配置/拦截风控看板/审计检索 UI）

### R3 P3 大功能（AI 完全体；表结构与状态机多数已备）

拍卖（英式/荷兰式/密封 + 保证金 + WS 竞价 + 反狙击）｜期货预售（锁价 + 保证金 + T-30 交割提醒）｜市场情报引擎（UN Comtrade/Eurostat 接入 + AI 周报，替换首页演示行情）｜各角色 AI Copilot（DeepSeek + RAG/pgvector）｜经营分析看板（GMV/漏斗/Broker 业绩）｜撮合模型化（embedding 相似度 + 转化率，替换规则引擎）

### R4 工程债

并发预留测试（行锁 + CHECK 验证）｜账本借贷平衡不变量测试｜Playwright 浏览器 E2E｜恢复 CI（工作流在 git 历史 733e451 前）｜API 镜像瘦身（pnpm deploy，1.5GB → 数百 MB）｜Redis 分布式限流｜覆盖率门禁（核心域 ≥85%，Step 2 NFR）

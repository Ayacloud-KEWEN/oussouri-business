# HANDOFF — 新会话接续开发指南

> 更新：2026-07-22（每次大批次交付后更新本文件）
> 用途：在新的 Claude 会话/新开发者接手时，读完本文即可继续开发，无需翻聊天记录。

---

## 1. 一句话现状

**Oussouri Caviar HUB**（居间控制型中欧鱼子酱 B2B 平台，oussouri.fr/.com）：**P1 交易闭环 + P2 五批 + R2 全量 + R1 主体 + R1.5 全部 + R1.6 全部 + B 组合规运营**已交付，部署在用户 OVH VPS（CloudPanel）。

**能力现状**：注册审核 → 上架/溯源/库存 → 下单（直采/RFQ/居间代下单/样品单/框架合同挂靠）→ **分期付款进托管** → 接单备货 → 单证齐备度守卫 → 发货（**尾款未清拦截**）→ 双边报关 → 冷链温度 → 签收 → **争议裁决**或放款分账。横向还有**证照到期扫描 / GDPR 行权 / 单证像素级脱敏**三项合规能力。三语（中/英/法）+ 身份防火墙 + 审计全覆盖。**三家真实供应商与两笔真实交易已入库**。

**唯一阻断上线的事**：Stripe / SMTP / S3 三组真实密钥未配（代码已就绪并按占位符自动降级，见 §5）。

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
pnpm --filter @oussouri/api test          # 44 单测
# 起 API 后按改动范围重跑冒烟（apps/api/scripts/）：
# smoke.ts(29) smoke-p2.ts(13) smoke-fulfillment.ts(17) smoke-p2x.ts(17) smoke-compliance.ts(34) smoke-reservations.ts(17)
npx tsx scripts/check-ledger.ts   # 改过资金流必跑：对整库校验借贷平衡/托管不透支
# 冒烟全绿会自动回收本次数据；有失败项则保留现场供排查，事后用 scripts/clean-test-data.ts 清
pnpm --filter @oussouri/web build
# 涉静态资源/Docker 的改动：构建生产镜像 docker run 验证（standalone ≠ dev server）
```

提交信息英文、结尾 Co-Authored-By（见 git log 惯例）；**多行提交信息用 `git commit -F 文件`**（PowerShell 内嵌引号会炸）；推送 origin main（仓库公开：github.com/Ayacloud-KEWEN/oussouri-business）。

## 5. 下一步

### 5.1 立即可做的唯一阻断项：真实密钥联调（R1-8）

三组密钥填进 VPS `.env.production` 后重启即自动切换（未配时按假适配器/本地磁盘正常运行，不影响演示）：

| 服务 | 变量 | 配好后的变化 |
|---|---|---|
| Stripe | `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` | 模拟支付 → 真实 Elements 卡收银台；Connect 打款到供应商账户 |
| SMTP | `SMTP_HOST/PORT/USER/PASS/FROM`（或 `SMTP_URL`） | 日志 → 真发信（域名侧另需 SPF/DKIM/DMARC） |
| OVH S3 | `S3_ENDPOINT/REGION/BUCKET_PRIVATE/ACCESS_KEY/SECRET_KEY` | 本地磁盘 → 对象存储 |

### 5.2 其余未做项（按优先级，详见 development-guide §9「未完成功能总览」）

- ~~**B 合规运营**~~ 已全部交付（2026-07-22，见 §5.3 表末行）
- **D P3 大功能**（表结构多已备、零实现）：拍卖｜期货预售｜市场情报引擎｜AI Copilot（RAG/pgvector）｜经营分析看板｜撮合模型化
- **E 工程债**：Playwright E2E｜恢复 CI｜并发预留测试｜账本借贷平衡不变量测试｜镜像瘦身｜Redis 限流｜覆盖率门禁

### 5.3 交付批次速查（技术要点，接手前扫一眼）

| 批次 | 关键落点 |
|---|---|
| R2（07-11/12） | 忘记密码 + httpOnly cookie 会话 + TOTP 2FA｜WS 通知｜全文搜索｜DeepSeek 机翻管道｜可见性策略拦截器｜后台补齐 |
| 法国伙伴档案（07-22） | `seed-french-partners.ts`（源 `HZB/法国经销商.docx`，幂等）：**只建主体档案不建交易**；找 JINGLIN 真身**按演示账号 `buyer-a@demo.oussouri` 的成员关系**定位，不能按 createdAt 取最早（07-23 实测最早的那个是 smoke 影子副本，一度补错了主体） —— 补全既有 JINGLIN 买家的 VAT/RCS/注册地址，新建 WELLHOPE / ZHOU LIHANG / CHEN STEINKERQUE / 客户001 四份档案（状态 `INACTIVE`，不占 PENDING 入驻队列）。四笔历史零售单与发票只写进 `riskNotes`——那是**经销商下游业务**，平台 TradeOrder 的佣金/托管/报关/CITES 全不适用，硬导会污染 GMV 统计。**两个 IBAN 刻意不入库**（平台收款走 Stripe Connect，无银行账号字段） |
| 真实数据（07-15/20/21） | 三家真实供应商 seed（`seed-hzb-case` / `seed-tuopai-supplier` / `seed-liangmei-supplier`，均幂等）｜`Product.attributes` 承载营养/工艺/品鉴｜外贸学院 `/help/academy`（内容在 `content/academy.ts`）｜首页数据达阈值切实时（`STATS_LIVE_THRESHOLD`）+ 洞察后台可配 |
| 上手引导（07-21） | `components/getting-started.tsx` 按真实数据判进度；文案在 `messages/*.json` 的 `guide`/`help` 段，改措辞不必动代码 |
| 履约可视化（07-21） | `GET /orders/:code` 聚合 + `/[locale]/orders/[code]` 页（单证齐备度/双边报关/航段/冷链 SVG/时间线）｜`StoragePort`（本地+S3 手写 SigV4）｜单证原件私有通道（买家取不到原件，payload 只给 `hasFile`）｜Stripe Elements + Connect |
| R1.5 真实贸易（07-22） | `PaymentMilestone` 分期（checkout 每次只收最早未付一期，`PAYABLE_STATES` 控制可付状态）｜`TradeContract` 框架合同（总量上限含 ±tolerance，条款模板下发）｜`CitesPermitLine` 一证多物种（扣减须带 `speciesCode`）｜`OrderType.SAMPLE`（免 MOQ，≤5kg） |
| A 组（07-22） | `dispute.service.ts` 争议全流程（三种裁决的资金分配见代码注释）｜`smtp.adapter.ts` 零依赖手写 SMTP |
| 库存与资金底线（07-23） | **修掉预留永久泄漏**：三条下单路径都给预留设了 24h TTL，但此前**没有任何东西执行它** —— 买家不付款也不取消，货就永久锁死（HANDOFF 旧第 11 条「demo SKU 库存被测试耗尽」多半是这个）。`trading/reservation-sweeper.service.ts` 每 10 分钟扫，PLACED 订单走状态机转 CANCELLED（由既有副作用释放预留），已付款/支付在途（PENDING 支付 24h 宽限）一律不碰。状态机 seed 给 `PLACED→CANCELLED` 加了 SYSTEM 角色 ｜ **账本不变量** `settlement/ledger-invariants.ts`：日记账借贷相等、不混币种、金额恒正、托管不透支；12 条单测照抄生产公式（改错分账算法会红），`scripts/check-ledger.ts` 对整库体检 |
| 工程卫生（07-23） | **镜像瘦身** 1.36GB→755MB：依赖只装 api 分支（不再顺带装 web 那套 Next/React）+ `pnpm deploy --prod` 产自包含目录；`tsx` 移入 dependencies 以保住容器内跑 seed 脚本的能力。**顺带堵了个泄露**：`apps/api/uploads` 22MB 曾被烤进生产镜像（单证原件 + HZB 合同 + GDPR 导出包），已加进 `.dockerignore` 并用 package.json `files` 白名单双重兜底 ｜ **测试数据治理**：`scripts/clean-test-data.ts`（默认预览，`--yes` 才删）+ 五套 smoke 收尾自动回收；`smoke.ts` 过去直接借用真实公司名，每跑一次就多一对与华芝宝/JINGLIN 同名的影子主体（本地积到 88 家主体），现已改为带 run 时间戳 |
| B 组合规（07-22） | 新增 `modules/compliance/`：`cert-expiry.service.ts` 每日 03:00 扫三类证照（60/30/7 分档 + 过期置 EXPIRED，用 `Notification.payload.dedupeKey` 去重保幂等）｜`gdpr.service.ts` DSR 工作流（EXPORT 打包进私有存储凭一次性令牌 72h 取；DELETE 是**匿名化**不是物理删，交易/账本/审计按 Art.17(3) 保留）｜`fulfillment/document-redactor.ts` 像素级打码（PDF→pdf-lib 黑块+水印，位图→sharp；坐标**左上角原点**）。冒烟 `scripts/smoke-compliance.ts`（34 项） |

> **法国伙伴档案的两个待补口**（运营侧补录，不是代码欠账）：客户 001 的公司全称至今只有「客户编码 001」；WELLHOPE 的法定代表人与成立日期空缺。三个下游零售产品（1000g / Hybrid 30g / esturgeon 30g）若要上架，走正常供应商产品流程由 codegen 发编码，**不要用文档建议的 `P-CAV-*` 命名**（平台编码规则是 `PRD-{seq:6}`）。

> **新库/新环境必做**：`npx tsx prisma/seed/index.ts`（含新增的 `CONTRACT` 编号规则与 `RESOLVED→COMPLETED` 状态转换）+ `npx tsx scripts/migrate-cites-lines.ts`（CITES 历史数据合并，幂等）。

## 5.5 文档可信度提示

本文与 development-guide §9 的完成状态均经**代码级核实**（grep 控制器/@Cron，而非沿用旧表述）。历史上出现过两次"文档说已就绪、实际是空壳"（争议功能、订单详情页），故接手后若发现描述与代码不符，**以代码为准并回头修文档**。

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
10. **改资金流必须端到端验证**：分期付款曾因 checkout 只允许 `PLACED` 状态而导致尾款永远付不了 —— 单测与类型检查都发现不了，只有跑完整"下单→首期→发货拦截→尾款→放行"才暴露。
11. **报 `INVENTORY_INSUFFICIENT` 先看有没有过期预留没放出来**：~~demo SKU 库存被反复测试耗尽~~ 根因已于 2026-07-23 查明并修复 —— 是预留 TTL 从来没被执行，未付款订单把货永久锁死。现有 sweeper 每 10 分钟回收；急用可手动 `POST /admin/reservations/sweep`。若仍不足才是真的库存不够，补一批即可。
12. **改资金流后跑 `scripts/check-ledger.ts`**：单测只保公式，这个脚本对整库查历史累积（早期写坏的账、并发重复入账、人工改库）。退出码非 0 即有问题。

## 7. 未合并的已知琐碎项

- `docs/demo-preparation.md` §1 表格里有用户手填的测试账号（test01–04@gmail.com），是用户自己的备忘，勿删；
- ~~首页平台数据带待接实时~~ 已解决（2026-07-16）：达阈值自动切换，阈值在 `page.tsx STATS_LIVE_THRESHOLD` 可调；
- CI 已按用户要求移除（恢复参考 git 历史 733e451 之前的 `.github/workflows/`）。

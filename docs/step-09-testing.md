# OUSSOURI AI — Step 9 测试

> 版本：V1.0　日期：2026-07-04
> 状态：已实施并全绿 → 确认后进入 Step 10（部署）

---

## 1. 测试金字塔与现状

| 层 | 工具 | 范围 | 现状 |
|---|---|---|---|
| 单元测试 | Jest + ts-jest | 内核纯逻辑（不依赖 DB/网络） | **5 套件 / 32 用例全绿**，`pnpm --filter @oussouri/api test` |
| E2E 冒烟 | tsx 脚本（真实 HTTP + 真实 DB） | P1 全业务闭环 | **29 项检查全绿**，`npx tsx scripts/smoke.ts`（需 API + DB 运行） |
| CI | GitHub Actions | install → prisma generate → typecheck → 单测 → 双端 build | `.github/workflows/ci.yml`，push/PR 自动触发 |

## 2. 单元测试清单（按风险选点）

| 套件 | 覆盖的业务风险 | 关键用例 |
|---|---|---|
| `crypto.service.spec` | PII 加密是身份防火墙存储层底座 | 中文/特殊字符往返、随机 IV（同文不同密文）、**密文篡改必须抛错**（GCM 认证）、盲索引归一化、口令散列 |
| `pii-filter.service.spec` | IM 拦截漏检 = 供需直连；误拦 = 可用性事故 | 7 类命中（法/中手机、邮箱、微信、WhatsApp、URL、IBAN）+ 4 类放行（正常询价、含数量、法语、**含平台订单号**） |
| `code-pattern.util.spec` | 公开编码是对外身份 | SP-000018 / ORD-日期-序列 格式、超位不截断、**编码不含地域信息（决策 D1 回归锚点）** |
| `price-tier.util.spec` | 定价错误直接损失金额 | 三档六个边界点（含 50kg 边界——Step 7 冒烟发现的缺陷回归）、缺档/空档 |
| `state-machine.service.spec` | 状态跳跃 = 资金/履约风险 | 合法迁移放行+事件名、未定义迁移拒绝、**买家不能自己标记已支付**、通配符角色 |

## 3. 本步发现并修复的缺陷

**PII 过滤器误拦平台编码**：`ORD-20261120-00001` 的数字段被 PHONE 规则命中——用户在 IM 里提订单号会被拦截并计入违规（3 次冻结会话，影响严重）。修复：扫描前剔除平台公开编码模式（编码本就是设计上允许交换的内容）。已加回归用例。

## 4. 可测试性重构

- 阶梯价选择抽出为纯函数 [price-tier.util.ts](../apps/api/src/modules/trading/price-tier.util.ts)（trading.service 复用）
- 编码渲染抽出为纯函数 [code-pattern.util.ts](../apps/api/src/kernel/codegen/code-pattern.util.ts)（可注入时间，测试可控）
- 状态机校验通过 mock PrismaService 测试，无需数据库

## 5. E2E 冒烟覆盖（scripts/smoke.ts，29 项断言）

注册（编码签发）→ 审核 → 上架（含审核流）→ 入库 → **匿名脱敏四项断言**（仅代码/无价格/无公司名泄露）→ 下单（阶梯价/拆单）→ 假 Stripe 支付 webhook → 接单 → 发货（FIFO 出库）→ 签收 → Outbox 自动分账（佣金 1208/应收 13892 双分录断言）→ 库存归零断言 → IM 拦截 422 → 穿透审批 + 解密读取。

## 6. 后续测试债（P2 起偿还）

- 库存并发测试（两个事务同时预留同一批次，验证行锁 + CHECK 约束）
- Settlement 对账测试（账本借贷平衡不变量：每 journalId 借=贷）
- 前端组件测试（Testing Library）与 Playwright 浏览器 E2E
- CI 中跑 E2E（GitHub Actions services 起 Postgres + seed + smoke）
- 覆盖率门禁（核心域 ≥85%，Step 2 NFR 要求）

---

*确认后进入 Step 10：部署（OVH 生产 Docker Compose、Nginx、备份、CI/CD 发布流水线）。*

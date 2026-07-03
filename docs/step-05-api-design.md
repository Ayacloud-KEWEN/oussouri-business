# OUSSOURI AI — Step 5 API 设计

> 版本：V1.0　日期：2026-07-03
> 前置文档：step-04-database-design.md（已确认）
> 状态：待确认 → 确认后进入 Step 6（UI 设计）

---

## 1. 全局约定

### 1.1 基础

- Base URL：`https://api.oussouri.com/v1`（oussouri.fr 同源反代）；版本进 URL（`/v1`），破坏性变更升 `/v2`。
- 规范：OpenAPI 3.1，NestJS `@nestjs/swagger` 自动生成，`/docs`（内网/鉴权访问）。
- 命名：资源复数 kebab-case；ID 一律用 **公开编码**（`ORD-20261120-00001`），UUID 永不出现在 URL/响应。
- Content-Type：`application/json; charset=utf-8`；文件上传走预签名 URL 直传 S3（API 只发凭证）。
- 语言：`Accept-Language: zh-CN|en|fr`（默认按用户偏好），响应中的翻译内容按回退链渲染并带 `x-translation-status` 标记。

### 1.2 鉴权与安全

- `Authorization: Bearer <JWT>`（15min）；刷新走 `POST /auth/refresh`（httpOnly cookie 旋转）。
- 守卫链（每个端点固定顺序）：JWT → 角色（RBAC）→ 数据范围（OWN/PARTY/ALL）→ 字段可见性拦截器（响应裁剪）→ 出口 PII 过滤。
- 幂等：所有创建型 POST 支持 `Idempotency-Key` 头（Redis 24h 去重），支付/下单/出价强制要求。
- 限流（Redis 滑动窗口，响应带 `X-RateLimit-*`）：匿名 60/min；登录用户 300/min；登录端点 5/min/IP；出价 10/s/用户。
- 乐观锁：更新型请求带 `version` 字段，冲突返回 409。

### 1.3 统一响应与错误

```jsonc
// 成功（列表）
{ "data": [...], "meta": { "page": 1, "pageSize": 20, "total": 143, "totalPages": 8 } }
// 错误（RFC 9457 Problem Details）
{ "type": "https://docs.oussouri.com/errors/INVENTORY_INSUFFICIENT",
  "title": "Insufficient inventory", "status": 409,
  "code": "INVENTORY_INSUFFICIENT",
  "detail": "Requested 100kg, available 42kg",   // 三语按 Accept-Language
  "traceId": "req_8f3a..." }
```

错误码分层：`AUTH_*` / `PERM_*` / `VALIDATION_*` / `STATE_*`（状态机拒绝）/ `INVENTORY_*` / `PAYMENT_*` / `PII_BLOCKED` / `RATE_LIMITED`。

### 1.4 列表查询（GBR：分页/过滤/排序/搜索统一）

```
GET /products?page=1&pageSize=20&sort=-publishedAt,price
    &filter[category]=CAVIAR&filter[species]=DAU,SCH&filter[priceMin]=500
    &q=caviar 3.5mm        // q = 全文+语义混合搜索
```
- `pageSize` 上限 100；深分页（>10000 条）自动切游标 `cursor=`。
- 所有 filter 字段白名单声明（DTO 层），未知参数 400。

---

## 2. 端点目录（按限界上下文）

图例：🔓公开 ｜ 🅑 Buyer ｜ 🅢 Supplier ｜ 🅚 Broker ｜ 🅐 Admin 系（含专职角色）。仅列 P1/P2 主干，P3（拍卖/期货/情报）标注 [P3]。

### 2.1 Auth & IAM

```
POST   /auth/register              🔓 注册（含组织类型选择）
POST   /auth/login                 🔓 （内部角色返回 2FA challenge）
POST   /auth/2fa/verify            🔓
POST   /auth/refresh               🔓
POST   /auth/logout
GET    /me                         当前用户 + 角色 + 组织 + 权限清单
PATCH  /me                         语言偏好、通知偏好
GET    /admin/users                🅐 用户管理（冻结/解锁/角色分配）
POST   /admin/users/:id/roles      🅐
```

### 2.2 Party（入驻与主体）

```
POST   /party/onboarding                    🅑🅢 提交入驻资料（含证书文件 key）
GET    /party/onboarding/status             🅑🅢
GET    /party/profile                       🅑🅢 本组织资料
PATCH  /party/profile
GET    /party/certificates                  🅑🅢 本组织证书列表
POST   /party/certificates
GET    /party/addresses | POST | PATCH | DELETE
--- 平台侧 ---
GET    /admin/parties?filter[status]=PENDING   🅐 审核队列
POST   /admin/parties/:code/approve            🅐 { decision, notes }
GET    /admin/parties/:code                    🅐🅚 主体 360（默认脱敏）
POST   /admin/parties/:code/escalations        🅐🅚 穿透申请 { fields, reason }
GET    /admin/escalations?filter[status]=PENDING  超管审批队列
POST   /admin/escalations/:id/decide           超管
GET    /admin/parties/:code/sensitive?escalationId=  时限窗口内解密读取
```

### 2.3 Catalog（产品）

```
GET    /products                    🔓 目录（匿名脱敏：价格显示"登录询价"）
GET    /products/:code              🔓 详情（溯源摘要脱敏）
GET    /products/:code/price-tiers  🅑 阶梯价
GET    /catalog/categories | species | grades   🔓 字典（三语）
--- 供应商 ---
POST   /supplier/products                  🅢 创建（草稿）
PATCH  /supplier/products/:code            🅢
POST   /supplier/products/:code/skus       🅢
POST   /supplier/skus/:skuCode/price-tiers 🅢
POST   /supplier/products/:code/submit     🅢 提交审核
POST   /supplier/products/:code/ai-describe 🅢 AI 生成三语文案（草稿）
--- 审核 ---
GET    /admin/products?filter[status]=PENDING_REVIEW  🅐(QC)
POST   /admin/products/:code/review        🅐 { decision, reasons }
--- 翻译 ---
GET    /admin/translations?filter[status]=MACHINE_DRAFT  🅐 待复核
POST   /admin/translations/:id/review      🅐
```

### 2.4 Traceability（溯源）🅢

```
POST/GET/PATCH /supplier/production-units
POST/GET       /supplier/production-units/:id/subunits
POST/GET       /supplier/source-batches         （守卫：休药期校验在加工创建时执行）
POST           /supplier/source-batches/:id/care-records
POST/GET       /supplier/processing-batches     body: { sourceBatchId, steps[], ... }
POST           /supplier/processing-batches/:id/qc   🅐(QC) 质检结论
GET    /products/:code/trace            🅑 溯源视图（脱敏：无基地名/企业名）
```

### 2.5 Inventory 🅢

```
GET    /supplier/inventory/lots?filter[expiringDays]=30
POST   /supplier/inventory/lots               入库（须关联加工批次）
POST   /supplier/inventory/lots/:id/adjust    盘点调整（事由必填）
GET    /supplier/inventory/lots/:id/transactions   流水
```

### 2.6 Trading（购物车/订单/RFQ）

```
GET/POST/PATCH/DELETE  /buyer/cart | /buyer/cart/items       🅑
POST   /buyer/orders                    🅑 下单（幂等；自动拆单，返回订单组）
GET    /buyer/orders | /buyer/orders/:code
POST   /buyer/orders/:code/cancel       🅑（状态机守卫）
POST   /buyer/orders/:code/confirm-delivery   🅑 签收
POST   /buyer/orders/:code/disputes     🅑 发起争议 { reasonCode, evidence }
--- 供应商 ---
GET    /supplier/orders
POST   /supplier/orders/:code/confirm   🅢 接单
POST   /supplier/orders/:code/ship      🅢 { shipmentLegs[], lotAllocations[] }（守卫：单证齐备）
--- RFQ [P2] ---
POST   /buyer/rfqs                      🅑
GET    /buyer/rfqs | /supplier/rfqs（定向或经居间分发的）
POST   /supplier/rfqs/:code/quotes      🅢 报价
POST   /buyer/quotes/:id/accept         🅑 → 自动生成订单
--- 平台 ---
GET    /admin/orders                    🅐 全量订单（含双方代码映射）
POST   /admin/orders/:code/transition   🅐 人工状态迁移（事由必填）
GET    /admin/disputes | POST /admin/disputes/:id/resolve   🅐
--- 拍卖 [P3] ---
POST /supplier/auctions ｜ GET /auctions ｜ POST /auctions/:code/join（缴保证金）
POST /auctions/:code/bids（WS 同步）｜ GET /auctions/:code/bids（仅竞买号）
--- 期货 [P3] ---
POST /supplier/futures ｜ GET /futures ｜ POST /futures/:code/subscribe
```

### 2.7 Settlement（支付/结算）

```
POST   /payments/checkout               🅑 { orderCode } → Stripe PaymentIntent client_secret
POST   /payments/wire-proof             🅑 线下电汇水单上传
POST   /webhooks/stripe                 🔓(签名校验) 支付/分账/退款事件
GET    /buyer/invoices | /supplier/invoices    发票列表 + PDF 下载
--- 财务 ---
GET    /finance/ledger?filter[account]=ESCROW_HELD   🅐(Finance)
GET    /finance/reconciliation/daily    🅐 日终对账报告
POST   /finance/payments/:id/reconcile  🅐 线下水单核销
POST   /finance/refunds                 🅐 执行退款（争议裁决驱动）
GET    /finance/commission-rules | POST | PATCH   🅐
```

### 2.8 Fulfillment（物流/清关/单证）[P2]

```
GET    /orders/:code/shipment           🅑🅢（地址按可见性裁剪）
POST   /logistics/shipments/:id/legs    🅐(Logistics)
POST   /logistics/shipments/:id/temperature-logs   （CSV 批量/API）
GET    /orders/:code/customs            🅐(Customs)🅑(状态摘要)
POST   /customs/declarations | PATCH /customs/declarations/:id/transition  🅐(Customs)
GET    /customs/cites-permits?filter[expiringDays]=60   🅐(Customs) 配额看板
--- 单证 ---
POST   /documents/presign               上传预签名（私有桶）
POST   /documents                       登记单证元数据
GET    /documents?filter[refType]=ORDER&filter[refId]=...
POST   /documents/:id/mask-template     🅐 首次遮盖区标注
POST   /documents/:id/masked-copies     🅚 脱敏发送 { toOrgCode } → 生成水印副本+站内送达
GET    /orders/:code/doc-checklist      单证齐备度（缺件清单）
```

### 2.9 Brokerage（居间作业台）🅚 [P2]

```
GET    /broker/opportunities?sort=-urgencyScore   商机流（含四维分+解释）
GET    /broker/opportunities/:code                商机详情（买卖双方脱敏 360）
POST   /broker/opportunities/:code/claim          认领
POST   /broker/opportunities/:code/transition     状态迁移（LOST 需 reason）
POST   /broker/opportunities/:code/activities     跟进记录
POST   /broker/calls                    { targetOrgCode, opportunityCode } → 发起代理外呼
GET    /broker/calls/:id/status         通话状态轮询（或 WS）
POST   /broker/messages                 平台名义代发 { toOrgCode, templateCode?, body }
POST   /broker/orders                   居间代下单 { buyerOrgCode, lotId, qty, unitPrice, depositPct }
                                        → 生成意向单 + 24h 预留 + 向 Buyer 推送支付链接
GET    /broker/copilot/suggest          AI 话术/议价建议 { opportunityCode, intent }
```

### 2.10 Communication

```
GET    /conversations | GET /conversations/:id/messages
POST   /conversations                   { topicType, topicId }（守卫：必须挂业务对象）
POST   /conversations/:id/messages      （出口 PII 拦截：422 PII_BLOCKED）
GET    /notifications | POST /notifications/:id/read
GET/PATCH /notification-preferences
--- 管理 ---
GET    /admin/conversations/:id         🅐 争议取证（读留审计）
GET    /admin/message-blocks            🅐 拦截风控看板
```

### 2.11 AI Platform & Intelligence

```
POST   /ai/assistant/chat               各角色 Copilot（SSE 流式；工具调用继承用户权限）
POST   /ai/translate                    内部服务间调用（管道触发为主）
GET    /admin/ai/usage                  🅐 token 成本看板
[P3]
GET    /intelligence/reports | POST /intelligence/reports/generate   🅐
GET    /analytics/dashboard?scope=platform|broker|supplier
```

---

## 3. WebSocket 协议（Socket.IO，命名空间隔离）

| 命名空间 | 事件（服务端→客户端） | 订阅鉴权 |
|---|---|---|
| `/ws/notifications` | `notification.new` | 本人 |
| `/ws/chat` | `message.new`、`message.blocked`、`typing` | 会话参与者 |
| `/ws/auctions` [P3] | `bid.accepted`、`price.current`、`auction.extended`（反狙击）、`auction.closed` | 已缴保证金的参与者；房间内只广播竞买号 |
| `/ws/broker` | `opportunity.new`（红点）、`call.status` | Broker 角色 |

客户端→服务端仅 `auction.bid` 与 `chat.send`（与 REST 等价、复用同一守卫链）。

## 4. Webhook（入站）

| 来源 | 端点 | 处理 |
|---|---|---|
| Stripe | `POST /webhooks/stripe` | 签名校验 → 事件持久化（幂等去重）→ 状态机迁移（PAID_ESCROW 等）→ 账本分录；每日对账兜底 |
| Twilio | `POST /webhooks/twilio/call-status` | CallLog 更新（时长/结果） |

## 5. OpenAPI 治理

- DTO 单一来源：`packages/shared` zod schema → 生成 class-validator + OpenAPI schema + 前端类型（三端一致）。
- 每个端点必须声明：`@Roles()`、`@DataScope()`、限流档位、幂等要求、可见性资源标签（拦截器据此裁剪）。CI 校验：缺任一装饰器则构建失败。
- 变更管理：OpenAPI diff 进 PR 检查，破坏性变更需版本升级评审。

---

*本文档为 Step 5 产出。确认后进入 Step 6：UI 设计（信息架构、页面清单、设计系统、关键页面线框）。*

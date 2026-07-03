# OUSSOURI AI — Step 1 需求分析报告

> 项目：OUSSOURI AI — Global Premium Food Trading Operating System
> 域名：oussouri.fr（欧盟主站）/ oussouri.com（全球站）
> 版本：V1.0　日期：2026-07-03
> 输入文档：masterprompt.md、需求分析（初稿）.docx
> 状态：待确认 → 确认后进入 Step 2（需求改进与补全）

---

## 1. 业务本质分析（Business Analysis）

### 1.1 平台是什么

OUSSOURI AI 不是开放式撮合市场（不是 Alibaba），而是一个 **居间方控制型（Broker-Controlled）的全球高端食品 B2B 交易操作系统**。平台自身就是交易的核心居间人，其商业模式建立在三个支柱上：

1. **身份隔离（Identity Firewall）** — 供需双方永远只能看到平台代码（`SP-00018` / `BY-00256`），真实身份（公司名、联系人、电话、邮箱、地址、公章）由平台独占。这是平台的生存底线：一旦供需直连，平台即失去价值。
2. **全链路托管（Full-Chain Custody）** — 通讯（站内 IM + 代理外呼）、单据（脱敏后转发）、资金（Escrow 托管分账）、物流清关（平台代办）全部经由平台，任何环节都不给双方绕开的机会。
3. **AI 撮合引擎（AI Matchmaking）** — 平台的核心增值：持续分析供需行为数据，主动向居间客服（Broker）推送高价值商机，把客服变成"拥有上帝视角的超级撮合商"。

### 1.2 首发行业与扩展性约束

首发行业为黑龙江鲟鳇鱼制品（鱼子酱、鲟鱼肉、鱼皮、软骨、鱼籽等），未来须扩展到松露、和牛、海鲜、葡萄酒等奢侈农产品。**因此架构必须行业无关（industry-agnostic）**：

- 品类（Category）、品种（Species）、等级（Grade）、加工流程（Processing Workflow）、合规单证类型（Certificate Type）、HS 编码等全部做成 **可配置的元数据**，不得硬编码"鲟鱼"概念到核心交易模型中。
- 初稿中的养殖/加工模型（Farm、Fish_Batch、RFID、Processing_Step）应抽象为通用的 **"溯源域（Traceability Domain）"**：产源单元（Production Unit）→ 原料批次（Source Batch）→ 加工批次（Processing Batch）→ 产品库存批次（Inventory Lot），鲟鱼只是第一个行业模板。

### 1.3 与初稿定位的差异（masterprompt 优先）

| 维度 | 需求初稿 | masterprompt 要求 | 结论 |
|---|---|---|---|
| 行业范围 | 仅鲟鳇鱼 | 行业无关、可扩展 | 溯源与产品模型抽象化 |
| 技术栈 | 未指定（提到华为云） | Next.js + NestJS + PostgreSQL + Prisma + Redis + pgvector | 以 masterprompt 为准 |
| 主键 | BIGINT 自增 | UUID | UUID 为主键，另设人类可读业务编码 |
| 代码格式 | S-HLJ-0001 / B-FR-0001 | SP-00018 / BY-00256 | 采用可配置编码规则引擎，兼容两种格式（详见 Step 2 决策点） |
| AI | 仅撮合看板 | AI-native，22 个模块全面 AI 化 | 按 masterprompt 扩展 |
| 角色 | 管理员/供应商/采购商/客服 | 11 种角色 RBAC | 按 masterprompt 扩展 |

---

## 2. 角色与用例分析（Actors & Use Cases）

### 2.1 角色清单（RBAC）

| # | 角色 | 核心职责 | 关键权限特征 |
|---|---|---|---|
| 1 | Guest 访客 | 浏览公开市场、注册 | 只见脱敏信息 |
| 2 | Buyer 采购商 | 搜索/收藏/询价/竞拍/下单/付款/签收 | 只见供应商代码；只见自己的订单 |
| 3 | Supplier 供应商 | ERP 录入（基地/批次/加工）、发布产品、发货 | 只见采购商代码；只见自己的订单 |
| 4 | Broker 居间客服/撮合专员 | 商机看板、代理外呼、脱敏发单、居间代下单 | 见双方代码 + 经审批穿透查看真实信息 |
| 5 | Customer Service 客服 | 工单、争议处理、咨询 | 有限脱敏视图 |
| 6 | Quality Inspector 质检员 | 审核加工批次、质检报告、证书核验 | 溯源域读写 |
| 7 | Logistics Operator 物流专员 | 订舱、运单、温度/GPS 追踪 | 物流域读写 + 收货地址可见 |
| 8 | Customs Officer 清关专员 | CITES/健康证/报关单证管理、清关状态 | 合规域读写 + 报关抬头可见（审计） |
| 9 | Finance 财务 | 托管账户对账、分账、退款、发票、佣金 | 资金域读写 + 税务抬头可见（审计） |
| 10 | Administrator 管理员 | 审核入驻、内容管理、配置 | 全量可见（审计） |
| 11 | Super Administrator 超管 | 权限分配、审计中心、穿透审批 | 全量 + 收到所有穿透告警 |

### 2.2 核心用例（按域）

**供应域**：供应商注册 → 资质审核（SC/CITES/出口许可） → 录入产源单元与批次（RFID 溯源） → 录入加工批次与工序 → 发布产品（三语、等级、阶梯价、库存批次）→ 上架/申请拍卖/发布期货合约。

**采购域**：注册审核 → 浏览/搜索（多语种、语义搜索）→ 收藏/加购 → 发布 RFQ/LOI → 参拍（缴保证金）→ 下单 → Escrow 付款 → 追踪物流清关 → 签收 → 评价。

**居间域（平台核心）**：AI 商机看板（需求聚合 × 库存对齐 → 匹配评分弹窗）→ 一键代理外呼（VoIP，号码不可见）→ 平台代发通知（官方名义邮件/站内信）→ 单据脱敏一键发送（自动遮盖公章/厂名 + 平台水印）→ 居间代下单（生成带支付链接的意向单，24h 锁货）→ 权限穿透申请（事由 + 审计 + 抄送超管）。

**履约域**：订单状态机 → Escrow 冻结 → 供应商发货 → 冷链物流（温度/GPS）→ 出口报关（CITES、健康证、卫生证、原产地证、发票、装箱单、运单 7 类单证）→ 进口清关（关税/VAT）→ 签收 → Escrow 释放 → 争议仲裁通道。

**交易模式**：直购（DIRECT）、拍卖（英式/荷兰式/密封 + 保证金）、RFQ 询价、期货（FUTURES：锁价 + 10–20% 保证金 + 交割期 T-30 提醒 + 尾款）。

---

## 3. 模块映射与差距分析（Gap Analysis）

masterprompt 的 22 个模块与初稿覆盖情况：

| 模块 | 初稿覆盖 | 差距（Step 2 需补全） |
|---|---|---|
| 1 Marketplace | 部分 | 前台商城、多语 SEO、语义搜索、收藏/购物车模型缺失 |
| 2 Supplier ERP | ✅ 较全 | 养殖模型需抽象为通用溯源域；缺成本/产能分析 |
| 3 Buyer CRM | 部分 | 缺客户分层、跟进记录、LOI/采购意向书实体 |
| 4 Product Management | ✅ 较全 | 多语字段应改为 i18n 翻译表而非 `_en/_fr` 平铺列 |
| 5 Inventory | ✅ 基本 | 缺库存流水（Ledger）、预留/释放事务、效期告警 |
| 6 Auction | ✅ 基本 | 缺保证金模型、自动出价代理、反狙击延时规则 |
| 7 RFQ | ❌ 缺失 | 全新设计：RFQ → Quote → 议价 → 转订单 |
| 8 Order Management | ✅ 基本 | 状态机未定义完整；缺合同/形式发票（PI）实体 |
| 9 Escrow Payment | 部分 | 有托管概念，缺分账、佣金、退款、多币种汇率、账本 |
| 10 Logistics | ✅ 基本 | 缺多段运输（HRB→PEK→CDG）、冷链事件告警 |
| 11 Customs | ✅ 较全 | 缺单证生成引擎、CITES 配额管理、单证效期提醒 |
| 12 Certificates | 部分 | 分散在供应商/报关表中，需统一"合规单证域"+ 脱敏发送 |
| 13 AI Matchmaking | ✅ 概念清晰 | 缺评分模型定义（Matching/Opportunity/Urgency/Profit）与行为数据埋点 |
| 14 AI Broker | ✅ 概念清晰 | 外呼、代发通知、脱敏发送需落地为具体服务 |
| 15 AI Translation | ❌ 缺失 | 全新设计：内容翻译管道 + 人工复核工作流 |
| 16 Notification Center | 部分 | 需统一多通道（站内/邮件/短信）模板 + 三语渲染 |
| 17 Internal Messaging | 提及 | 站内 IM：会话、敏感信息拦截（电话/邮箱正则屏蔽）缺失 |
| 18 Admin Console | 部分 | 需统一后台：审核流、配置中心、编码规则引擎 |
| 19 Audit Center | ✅ 有表 | 缺穿透审批工作流（Access Escalation）与告警抄送 |
| 20 Analytics Dashboard | ❌ 缺失 | GMV、转化、供需缺口、客服撮合业绩看板 |
| 21 Market Intelligence | ❌ 缺失 | 国家/HS Code/价格/竞品/需求趋势 + 自动报告生成 |
| 22 AI Assistant | ❌ 缺失 | 各角色 Copilot + RAG 知识库（pgvector） |

### 3.1 初稿数据库设计需要修正的企业级问题

1. **主键**：BIGINT 自增 → UUID（防遍历、防内部 ID 泄露，masterprompt 强制）。
2. **i18n**：`company_name_en/fr`、`description_en/fr` 平铺列 → 独立翻译表（`*_translation(entity_id, locale, field, value)`），支持未来增加语种。
3. **软删除与审计列**：初稿多数表缺 `deleted_at / created_by / updated_by / version`，需全表补齐。
4. **用户与身份分离**：初稿把联系人电话/邮箱直接放业务表 → 需独立 `User / Account / Membership` 体系（OAuth + RBAC），敏感字段（电话、邮箱、税号）**列级加密**。
5. **`Order` 是 SQL 保留字** → 表名规范化（如 `orders` / `trade_order`）。
6. **资金模型**：只有 Payment 表 → 需要 Escrow 账户、账本分录（double-entry Ledger）、分账指令、佣金规则、退款单。
7. **状态机**：订单/拍卖/报关状态只列了枚举 → 需定义完整状态迁移与守卫条件（谁、在什么条件下、能触发什么迁移），并写入审计。
8. **杂交品种代码**（`DAU×HUS`）含特殊字符 → 编码规范化（如 `DAUHUS` 或父本/母本外键）。
9. **搜索**：需要 PostgreSQL 全文（中/英/法分词）+ pgvector 语义检索（Embedding），初稿完全未涉及。

---

## 4. 非功能需求（NFR）

| 类别 | 要求 |
|---|---|
| 国际化 | 中/英/法三语全覆盖（UI、数据、通知、邮件、发票、单证）；零硬编码文案；时区/货币/度量单位本地化 |
| 多币种 | EUR/USD/CNY/GBP/JPY；汇率快照随订单固化 |
| 安全 | GDPR（数据主体权利、数据驻留欧盟考量）、OWASP Top 10、列级加密（PII）、CSRF/XSS/SQLi 防护、全局 Rate Limit、内部 ID 永不外露 |
| 审计 | 所有关键操作 + 所有真实信息查看行为均留痕（人、时间、IP、字段、事由），穿透查看需审批并抄送超管 |
| 性能 | 列表接口 P95 < 300ms；拍卖出价实时（WebSocket）；行情看板准实时 |
| 可扩展 | 模块化 Monolith（NestJS 模块边界 = 未来微服务边界）；行业模板化；事件驱动（领域事件 → 通知/撮合/审计解耦） |
| AI-ready | 行为埋点标准化（搜索/收藏/加购/下单事件流）；Embedding 管道；LLM 调用抽象层（供应商可替换） |
| 部署 | Docker + Docker Compose + Cloud Panel；环境分离（dev/staging/prod） |

---

## 5. 关键风险（Risks）

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 供需绕开平台（最大商业风险） | 平台失去存在价值 | 身份防火墙 + IM 敏感信息拦截 + 单据脱敏 + 穿透审计（本平台的第一设计原则） |
| R2 | CITES/食品合规单证错误 | 货物扣关、法律责任 | 单证效期/配额校验引擎 + 清关专员审核工作流 |
| R3 | Escrow 资金合规（法国/欧盟支付牌照） | 无牌照不能碰资金 | 接入持牌 PSP（如 Stripe Connect / Mangopay / Lemonway，Step 3 决策），平台不自持资金 |
| R4 | GDPR（真实身份数据 + 通话记录） | 罚款 | 数据最小化、列级加密、DPA、可遗忘权流程 |
| R5 | 冷链断链（-2~0℃，保质期 60 天） | 货损争议 | 温度日志强制上传 + 阈值告警 + 争议证据链 |
| R6 | 初期数据冷启动（AI 撮合无数据） | AI 价值不显 | 规则引擎先行（可配置匹配规则），行为数据积累后模型化 |
| R7 | 一次性开发范围过大 | 交付失败 | 严格按十步工作流 + 模块分期（见 §6 分期建议） |

---

## 6. 实施分期建议（供 Step 3 架构设计参考）

- **Phase 1（MVP，核心闭环）**：身份/RBAC、供应商/采购商入驻审核、产品与库存、Marketplace（直购）、订单状态机、Escrow（PSP 托管）、站内 IM（含拦截）、通知中心、审计中心、Admin Console。
- **Phase 2（居间增值）**：AI 商机看板 + 评分、居间代下单、脱敏单据发送、代理外呼、RFQ、物流/清关全流程、供应商 ERP 溯源域。
- **Phase 3（AI-native 完全体）**：拍卖、期货、市场情报引擎 + 自动报告、各角色 AI Copilot、RAG 知识库、Analytics。

---

## 7. 待您确认的关键决策点（Open Questions）

进入 Step 2 前，以下问题需要您拍板（我在括号中给出建议默认值）：

1. **编码格式**：masterprompt 用 `SP-00018/BY-00256`，初稿用 `S-HLJ-0001/B-FR-0001`，客服场景又出现 `SP-2026-001`。（建议：编码规则做成可配置引擎，默认采用 `SP-000018` / `BY-000256` 简洁格式，不在公开代码中暴露省份/国家等可推断信息——地域信息本身就可能帮助买家绕过平台猜出供应商。）
2. **Escrow 方案**：接入哪家持牌 PSP？（建议：欧盟主站用 Mangopay 或 Stripe Connect；架构上做支付网关抽象层，国内收结汇后续接入。）
3. **AI 供应商**：masterprompt 指定 OpenAI Embedding；LLM 侧是否也用 OpenAI，还是需要兼容多供应商？（建议：LLM Provider 抽象层，默认 OpenAI，可切换。）
4. **VoIP 外呼**：初稿提到华为云通信/欧洲电信 API。（建议：抽象 Telephony 接口，首期用 Twilio Voice 落地，后续可换。）
5. **部署目标**：Cloud Panel 具体指哪家云/服务器？数据是否要求欧盟驻留（GDPR）？
6. **首期范围**：是否认可 §6 的三期划分，Step 7-8 实现从 Phase 1 开始？

---

*本文档为 Step 1 产出。确认后进入 Step 2：需求改进与补全（输出改进版需求规格说明书，含完整模块级功能清单与业务规则）。*

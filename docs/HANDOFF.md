# HANDOFF — 新会话接续开发指南

> 更新：2026-07-10（每次大批次交付后更新本文件）
> 用途：在新的 Claude 会话/新开发者接手时，读完本文即可继续开发，无需翻聊天记录。

---

## 1. 一句话现状

**Oussouri Caviar HUB**（居间控制型中欧鱼子酱 B2B 平台，oussouri.fr/.com）：P1 交易闭环 + P2 全部五批（撮合/居间代下单/RFQ/履约/脱敏发单/溯源/外呼）+ 演示批次（GDPR/实时行情/产品图片/省份图/一键演示数据）已完成，**已部署在用户 OVH VPS（CloudPanel）供人工测试与投资人演示**。下一步开发是路标 R1（真实收款能力）。

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

## 5. 下一步：路标 R1（用户已确认优先级）

按 development-guide §9 的 R1 表执行，建议顺序与要点：

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

## 7. 未合并的已知琐碎项

- `docs/demo-preparation.md` §1 表格里有用户手填的测试账号（test01–04@gmail.com），是用户自己的备忘，勿删；
- 首页平台数据带（88+ 养殖场等）仍为营销演示值（`portal-data.ts`），`/market/stats` 实时接口已就绪未接入——等真实数据量起来再切换；
- CI 已按用户要求移除（恢复参考 git 历史 733e451 之前的 `.github/workflows/`）。

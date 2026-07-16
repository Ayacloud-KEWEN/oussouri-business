/**
 * 学院（知识中心）文章内容 — 三语 Markdown（R1.5-5）。
 * 源文档：docs/caviar-trade-tutorial.md（基于真实完成的 50KG 输欧交易改写，敏感信息已隐去）。
 * 后续文章追加到 ARTICLES 数组即可。
 */

export interface AcademyArticle {
  slug: string;
  title: Record<string, string>;
  subtitle: Record<string, string>;
  readMin: number;
  body: Record<string, string>;
}

const ZH_BODY = `
> 本教程以一单**真实完成的交易**为教材：黑龙江一家鱼子酱加工厂向法国巴黎进口商出口 50KG 鲟鱼子酱，空运 CIF 巴黎，货值 €15,100，全流程单据齐备。数据与单据编号均来自真实档案（敏感信息已隐去）。

## 一、看懂这单生意

| 要素 | 本案例 |
|---|---|
| 商品 | 鲟鱼子酱两个品种（杂交鲟 + 施氏鲟）各 25KG，HS 编码 1604310000 |
| 包装 | 50g/100g/250g 马口铁罐，共 640 罐 / 4 箱，净重 50KG / 毛重 112KG |
| 价格 | CIF €302/KG，总价 €15,100 |
| 付款 | 买方收到 CITES 扫描件后 1 个工作日内 T/T 50%，发货前结清尾款 |
| 运输 | 空运（哈尔滨 → 广州 → 巴黎 CDG），全程 -2℃~0℃ 冷链 |
| 周期 | 签约 → 生产 → 起飞 → 交付，约 2 个月 |

**鱼子酱同时踩中三个监管红线**，缺一个证货就走不了：①所有鲟鱼都在 CITES（华盛顿公约）附录里，进出口两头都要许可证；②动物源性食品输欧必须来自欧盟注册工厂并附官方兽医证书；③保质期约 60 天、-2℃~0℃ 恒温——时间就是金钱。把这单学透，普通食品外贸就是"减配版"。

## 二、十步实操流程

### 第 0 步：资质准备（一次性投入）

**卖方（中国工厂）**：出口食品生产企业备案（厂号）｜欧盟注册（列入 TRACES 输欧水产名单）｜CITES 允许出口证明书（一批一证）｜对外贸易经营者备案 + 海关收发货人注册。

**买方（欧盟进口商）**：公司注册 + 增值税号（TVA/EORI）｜**进口国 CITES 进口许可证**（一批一证，如法国向 DRIEAT 申请，周期 2–6 周）｜TRACES 收货人登记。

> **新手最常犯的错**：以为只有出口国要办 CITES。错——**出口证（中国发）+ 进口证（进口国发）两证齐才合法**，进口证要买方自己提前申请。

### 第 1 步：谈判与签约

真实合同里值得抄的条款：**框架合同 + 分批补充协议**（合同期一年，每批另签补充协议）；**价格锁定**且总量允许 ±5% 浮动、按最终灌装重量结算；**付款与 CITES 挂钩**（买方确认"货合法能进口"才付预付款，卖方拿到钱才排产）；**发货截止条款**（逾期可取消并全额退款）；**品质免责**（纯盐渍无巴氏杀菌产品保质期内出油、变咸属正常，提前写进合同避免收货纠纷）；争议解决选定仲裁机构、约定以中文版本为准。

### 第 2 步：卖方申请 CITES 出口证

向濒管办提交合同、驯养繁殖证明、亲本来源、加工厂资质。证书逐项列明：物种拉丁名、附录级别（II-C 人工养殖）、各物种重量、**每罐标签号段**——罐数、重量、标签必须和后面所有单据完全一致。有效期一般 6 个月。**一致性是生命线**：CITES 上的数字和发票、装箱单、健康证差一个字，清关就卡住。

### 第 3 步：收 50% 预付款

卖方把 CITES 扫描件发买方 → 买方 1 个工作日内电汇 50%。电汇要素写全（收款人全称、账号、开户行、SWIFT CODE），并约定**以银行入账日为收款日**，避免"我汇了"扯皮。

### 第 4 步：生产与批号管理

收到预付款后排产。批号规则建议"企业代码+生产日期"（如 HZBSC20251114）。工艺要点写入随货文件：盐度 3.5%、无巴氏杀菌、籽粒 >3mm、储存 -2℃~0℃、保质期 60 天。**从生产日起 60 天倒计时开始**——后面每一步都在和保质期赛跑。

### 第 5 步：第三方检测

送 CNAS/CMA 资质实验室，5 天左右出报告。必测项目：兽药残留（氯霉素、硝基呋喃四项代谢物、孔雀石绿、结晶紫——**全部必须"未检出"**）、重金属、挥发性盐基氮、菌落总数、感官。这份报告是办健康证的前置材料，也是买方验货的信心来源。

### 第 6 步：海关检验检疫，出健康证 + 兽医证

向属地海关报检，产出两份关键证书：**健康证书**（中国官方"适合人类食用"证明）+ **动物卫生证书**（FISH-CRUST-HC 欧盟统一格式，官方兽医签字，逐条对应欧盟法规 852/2004、853/2004）——进口国口岸兽医查验就认这张。

### 第 7 步：收尾款、订舱

发货前买方结清尾款（"不结清不发货，货物临期损失买方承担"）。同步订空运舱位；AWB 的 Handling Information 栏必须写明 **KEEP REFRIGERATED**、厂号、批号、生产日期——地面操作全靠这行字。

### 第 8 步：出口报关

报关单证套装：合同、发票、装箱单、CITES 出口证**原本**、健康证、兽医证。商业发票与装箱单必须互相咬合：行数、单价、总额、罐数、箱数、毛净重、批号、厂号——所有数字与 CITES 一致。

### 第 9 步：进口国清关（买方主场）

买方委托口岸清关代理办理。进口侧成本结构（真实代理发票口径）：**关税约 20%（大头）**｜TRACES 登记 + DSCE 卫检档案｜边境口岸（BCP）兽医查验 + 海关查验｜CITES 进口证核销｜冷冻仓储按天计费（**单据不齐是最贵的错误**）｜官方翻译｜冷藏车派送。经验值：进口侧总成本可达货值的 25%–35%，买方报价时必须算进去。

### 第 10 步：冷链收货与结案

冷藏车（-2℃~0℃）送至买方冷库，到库后保持原位静置。买方核对罐数与 CITES 标签号段、温度记录、剩余保质期；有异议走第三方检测索赔，无异议交易完成。双方归档全套单据至少 5 年。

### 单据总清单

| # | 单据 | 谁出 |
|---|---|---|
| 1 | 商业发票（两正本） | 卖方 |
| 2 | CITES 出口许可证 | 出口国濒管办 |
| 3 | 原产地证书 | 贸促会/海关 |
| 4 | 装箱单 | 卖方 |
| 5 | 空运单 AWB | 航空公司 |
| 6 | 兽医（动物卫生）证书 | 海关官方兽医 |
| 7 | 健康证书 | 海关 |
| 8 | 第三方检测报告 | 检测机构 |
| 9 | CITES 进口许可证 | **买方**在进口国申请 |

## 三、在 Oussouri Caviar HUB 上完成这单交易

平台把撮合、下单、资金托管、单证管理、溯源、冷链跟踪全部线上化。三条底线先记住：①买卖双方互相只见平台代码，真实身份由平台居间保护；②货款进平台托管账户，**签收后才释放给卖方**；③单证原件平台存档，发给对手方的一律是脱敏副本。

### 卖家路径（9 步）

1. **注册入驻**：选"供应商"，平台审核激活（厂号/欧盟注册等资质录入主体档案）；
2. **登记 CITES 配额**：证号、物种、配额、有效期，平台按物种记账、发货自动核销、临期提醒；
3. **建溯源链**：生产单元 → 来源批次 → 加工批次（真实批号+工序）→ 平台质检 QC；
4. **上架产品**：品类/物种/HS 编码 → SKU（罐规/MOQ/保质期）→ 阶梯价 → 审核上架（自动机翻英法文，人工复核后展示）；
5. **入库存**：批次号用真实生产批号，关联加工批次，溯源自动打通；
6. **接单确认**：买家付款进托管后点"确认接单"；
7. **登记运单与单证**：Incoterms/箱数/毛重/航段 + 逐份登记单据编号与日期。**平台有单证齐备度校验：缺件时"发货"会被拦截**；
8. **发货**：录入冷链温度记录，超温自动告警；
9. **回款**：海关流转 + 买家签收后托管自动清算，扣佣入账。

### 买家路径（9 步）

1. **注册入驻**：选"买家"（进口商/批发商/餐饮），平台审核激活；
2. **选品比价**：供应大厅看溯源档案与平台背书的资质状态（登录可见批发价）；
3. **询价**：小单直接下单；大单发 **RFQ 反向招标**等多家报价，或请平台经纪人居间代谈；
4. **下单**：SKU 加购物车生成订单；
5. **付款进托管**：钱到平台托管账户而非卖方——签收前资金不会离开托管；
6. **办自己的证**：拿到卖方 CITES 扫描件（平台单证页可查脱敏副本）即向本国 CITES 机构递件申请进口证；
7. **跟踪**：订单页实时看状态流转、航段时刻、冷链温度曲线；
8. **签收结案**：核对无误点"确认签收"，托管释放；有质量问题在争议期内发起争议，平台冻结资金居中裁决；
9. **档案沉淀**：单证档案页永久保存脱敏副本（带追踪码），下次办证、应对稽查直接调取。

## 四、新手避坑清单

1. **CITES 双证**：出口证卖方办、进口证买方办，一批一证、有效期约 6 个月，倒排工期；
2. **数字一致性**：重量/罐数/批号/厂号在所有单据上必须一字不差；
3. **保质期倒计时**：60 天保质期，留给销售的往往只剩 30–40 天；
4. **付款节点写死**：预付款绑 CITES 扫描件、尾款绑发货，以银行到账日为准；
5. **进口成本别漏算**：关税 20% + 查验 + 冷冻仓储 + 冷链派送，可达货值三成；
6. **仓储按天烧钱**：单据不齐导致的口岸滞留，冷冻仓储费一天几百欧；
7. **合同语言与仲裁**：双语合同约定优先语言版本与仲裁机构；
8. **品质免责条款**：非巴氏杀菌产品出油变咸属正常，白纸黑字写进合同。
`;

const EN_BODY = `
> This guide is built on a **real, completed transaction**: a Heilongjiang caviar processor exporting 50 kg of sturgeon caviar to a Paris importer, air freight CIF Paris, invoice value €15,100, with a complete document trail. All figures come from the actual file (sensitive details redacted).

## 1. Understanding the deal

| Element | This case |
|---|---|
| Goods | Two sturgeon caviars (hybrid + Amur sturgeon), 25 kg each, HS code 1604310000 |
| Packing | 50/100/250 g tins — 640 tins / 4 cartons, 50 kg net / 112 kg gross |
| Price | CIF €302/kg, total €15,100 |
| Payment | 50% T/T within 1 business day of receiving the CITES scan; balance before shipment |
| Transport | Air (Harbin → Guangzhou → Paris CDG), -2 °C to 0 °C cold chain throughout |
| Timeline | Contract → production → wheels-up → delivery in about 2 months |

**Caviar sits on three regulatory red lines at once** — miss one certificate and the goods do not move: ① every sturgeon species is CITES-listed, so permits are needed on *both* ends; ② animal-origin food entering the EU must come from an EU-listed plant with an official veterinary certificate; ③ shelf life is ~60 days at -2 °C to 0 °C — time is literally money. Master this trade and ordinary food export feels easy.

## 2. The ten-step playbook

### Step 0: One-off qualifications

**Seller (Chinese plant)**: export food producer registration (plant number) | EU listing (TRACES) | CITES export permit (one per batch) | foreign-trade operator and customs registrations.

**Buyer (EU importer)**: company + VAT/EORI registration | **a CITES import permit from your own country** (one per batch; in France apply to DRIEAT, allow 2–6 weeks) | TRACES consignee registration.

> **The classic beginner mistake**: assuming only the exporting country needs CITES. Wrong — **the shipment is legal only with both the export permit and the import permit**, and the import permit is the buyer's job, well in advance.

### Step 1: Negotiation and contract

Clauses worth copying from the real contract: **frame contract + per-batch annexes** (one-year term, each shipment under its own annex); **locked price** with ±5% quantity tolerance settled on final filled weight; **payment tied to CITES** (buyer pays the deposit only after confirming the goods can legally enter; seller schedules production only after being paid); **shipment deadline clause** (cancel + full refund if missed); **quality disclaimer** (oil separation and saltiness within shelf life are normal for non-pasteurised salt-cured caviar — write it in to prevent disputes); agreed arbitration body and governing language.

### Step 2: Seller obtains the CITES export permit

Filed with the national CITES authority with the contract, captive-breeding evidence, broodstock origin and plant credentials. The permit lists species Latin names, appendix level (II, source C aquaculture), per-species weights and **the tin label number ranges** — tin counts, weights and labels must match every later document exactly. Validity is typically 6 months. **Consistency is life**: one mismatched digit between CITES, invoice, packing list or health certificate stalls customs.

### Step 3: Collect the 50% deposit

Seller sends the CITES scan → buyer wires 50% within one business day. Spell out full bank details (beneficiary, account, bank, SWIFT) and agree that **the bank credit date is the payment date**.

### Step 4: Production and lot management

Schedule production after the deposit lands. Lot code = company code + production date (e.g. HZBSC20251114). Put the process specs in the shipping file: 3.5% salt, non-pasteurised, grain >3 mm, storage -2 °C to 0 °C, 60-day shelf life. **The 60-day countdown starts on production day.**

### Step 5: Third-party testing

Use a CNAS/CMA-accredited lab (~5 days). Must-test: veterinary drug residues (chloramphenicol, four nitrofuran metabolites, malachite green, crystal violet — **all must be "not detected"**), heavy metals, TVB-N, plate count, sensory. This report unlocks the health certificate and anchors buyer confidence.

### Step 6: Customs inspection — health + veterinary certificates

Local customs issues two key documents: the **health certificate** (official fit-for-human-consumption attestation) and the **animal health certificate** (EU-format FISH-CRUST-HC, signed by an official veterinarian, mapped to Regulations 852/2004 and 853/2004) — the one EU border vets actually check.

### Step 7: Balance payment and booking

Balance is settled before shipment ("no balance, no shipment; shelf-life loss on the buyer"). Book air cargo; the AWB Handling Information box must say **KEEP REFRIGERATED** plus plant number, lot number and production date — ground handlers act on that line alone.

### Step 8: Export clearance

Document set: contract, invoice, packing list, **original** CITES export permit, health and veterinary certificates. Invoice and packing list must interlock — lines, unit price, totals, tin/carton counts, gross/net weights, lot and plant numbers — all matching CITES.

### Step 9: Import clearance (buyer's home game)

Handled by the buyer's port broker. Real cost structure from an actual broker invoice: **~20% import duty (the big one)** | TRACES + CHED sanitary file | border control post (BCP) veterinary and customs inspections | CITES import permit discharge | frozen storage billed per day (**incomplete documents are the most expensive mistake**) | sworn translation | refrigerated last-mile. Rule of thumb: import-side costs reach 25–35% of goods value — price it in.

### Step 10: Cold-chain receipt and closure

Refrigerated truck to the buyer's cold store; rest the tins in place on arrival. Verify tin counts against CITES label ranges, temperature logs and remaining shelf life. Claims go through third-party testing; otherwise the deal closes. Both sides archive the full file for at least 5 years.

### Document checklist

| # | Document | Issued by |
|---|---|---|
| 1 | Commercial invoice (2 originals) | Seller |
| 2 | CITES export permit | Export-country CITES authority |
| 3 | Certificate of origin | CCPIT / customs |
| 4 | Packing list | Seller |
| 5 | Air waybill | Airline |
| 6 | Veterinary (animal health) certificate | Official veterinarian |
| 7 | Health certificate | Customs |
| 8 | Third-party test report | Accredited lab |
| 9 | CITES import permit | **Buyer**, in the importing country |

## 3. Running the same deal on Oussouri Caviar HUB

The platform digitises matching, ordering, escrow, documents, traceability and cold-chain tracking. Three ground rules: ① counterparties only ever see platform codes — real identities stay protected by the platform; ② funds sit in platform escrow and are **released to the seller only after delivery confirmation**; ③ original documents are archived by the platform — counterparties receive redacted copies only.

### Seller path (9 steps)

1. **Register** as a supplier; the platform vets and activates you (plant number, EU listing filed to your profile);
2. **Register CITES quotas** — permit number, species, quota, validity; the platform tracks usage per species, auto-deducts on shipment and warns before expiry;
3. **Build the traceability chain**: production unit → source batch → processing batch (real lot number + steps) → platform QC;
4. **List products**: category/species/HS code → SKUs (tin size, MOQ, shelf life) → tiered prices → review and publish (machine-translated EN/FR, human-reviewed);
5. **Load inventory** under the real production lot, linked to the processing batch;
6. **Confirm orders** once the buyer's funds are in escrow;
7. **Register shipment and documents**: Incoterms, cartons, weights, flight legs, then every document with its number and dates. **A completeness check blocks "Ship" while documents are missing**;
8. **Ship** and log cold-chain temperatures — breaches alert automatically;
9. **Get paid**: after customs flow and buyer confirmation, escrow settles automatically minus commission.

### Buyer path (9 steps)

1. **Register** as a buyer (importer / wholesaler / restaurant); the platform vets and activates you;
2. **Compare products** in the marketplace with traceability files and platform-vetted credentials (wholesale prices visible when logged in);
3. **Enquire**: order small lots directly; for volume, post an **RFQ** for competing quotes or let a platform broker negotiate for you;
4. **Order** from the cart;
5. **Pay into escrow** — money goes to the platform, not the seller, and stays there until you confirm receipt;
6. **Get your own permit**: with the seller's CITES scan (redacted copy in your document vault), apply to your national CITES authority;
7. **Track** order states, flight legs and the temperature curve in real time;
8. **Confirm delivery** to release escrow — or open a dispute within the window and the platform freezes funds and adjudicates;
9. **Keep the archive**: redacted copies with tracking codes stay available for future permits and audits.

## 4. Beginner pitfall checklist

1. **Two CITES permits** — export (seller) and import (buyer), one per batch, ~6-month validity: plan backwards;
2. **Number consistency** — weights, tin counts, lot and plant numbers must match to the digit across all documents;
3. **Shelf-life countdown** — of 60 days, sales usually get only 30–40;
4. **Hard payment triggers** — deposit tied to the CITES scan, balance tied to shipment, bank credit date rules;
5. **Import costs** — 20% duty + inspections + frozen storage + cold delivery can reach a third of goods value;
6. **Storage burns daily** — port delays from missing documents cost hundreds of euros a day in frozen storage;
7. **Language and arbitration** — bilingual contracts must name the governing language and arbitration body;
8. **Quality disclaimers** — oil separation and saltiness are normal for non-pasteurised caviar; put it in writing.
`;

const FR_BODY = `
> Ce guide s'appuie sur une **transaction réelle et achevée** : un transformateur de caviar du Heilongjiang exportant 50 kg de caviar d'esturgeon vers un importateur parisien, fret aérien CIF Paris, valeur facturée 15 100 €, avec un dossier documentaire complet. Les chiffres proviennent du dossier réel (données sensibles masquées).

## 1. Comprendre l'affaire

| Élément | Ce cas |
|---|---|
| Marchandise | Deux caviars d'esturgeon (hybride + esturgeon de l'Amour), 25 kg chacun, code SH 1604310000 |
| Emballage | Boîtes de 50/100/250 g — 640 boîtes / 4 cartons, 50 kg net / 112 kg brut |
| Prix | CIF 302 €/kg, total 15 100 € |
| Paiement | 50 % par virement sous 1 jour ouvré après réception du scan CITES ; solde avant expédition |
| Transport | Aérien (Harbin → Canton → Paris CDG), chaîne du froid -2 °C à 0 °C |
| Délai | Contrat → production → décollage → livraison en 2 mois environ |

**Le caviar cumule trois lignes rouges réglementaires** : ① tous les esturgeons sont inscrits à la CITES — permis exigés *des deux côtés* ; ② les denrées d'origine animale entrant dans l'UE doivent provenir d'un établissement agréé UE avec certificat vétérinaire officiel ; ③ DLC d'environ 60 jours entre -2 °C et 0 °C — le temps, c'est de l'argent. Maîtrisez ce commerce et l'export alimentaire ordinaire paraîtra simple.

## 2. Le processus en dix étapes

### Étape 0 : qualifications préalables (une fois)

**Vendeur (usine chinoise)** : enregistrement d'exportateur alimentaire (n° d'usine) | agrément UE (TRACES) | permis d'exportation CITES (un par lot) | enregistrements commerce extérieur et douane.

**Acheteur (importateur UE)** : société + TVA/EORI | **permis d'importation CITES de votre propre pays** (un par lot ; en France auprès de la DRIEAT, comptez 2 à 6 semaines) | enregistrement destinataire TRACES.

> **L'erreur classique du débutant** : croire que seul le pays exportateur gère la CITES. Faux — **l'envoi n'est légal qu'avec le permis d'export ET le permis d'import**, et le permis d'import incombe à l'acheteur, bien en amont.

### Étape 1 : négociation et contrat

Clauses à copier du contrat réel : **contrat-cadre + avenants par lot** (durée un an) ; **prix verrouillé** avec tolérance de ±5 % réglée au poids final ; **paiement lié à la CITES** (l'acheteur ne verse l'acompte qu'après avoir vérifié que la marchandise peut entrer légalement ; le vendeur ne produit qu'une fois payé) ; **clause de date limite d'expédition** (annulation + remboursement intégral) ; **décharge qualité** (exsudation d'huile et salinité pendant la DLC sont normales pour un caviar salé non pasteurisé — l'écrire évite les litiges) ; arbitrage et langue faisant foi désignés.

### Étape 2 : le vendeur obtient le permis CITES d'export

Déposé auprès de l'autorité CITES avec contrat, preuves d'élevage, origine des géniteurs et agréments. Le permis détaille noms latins, annexe (II, source C aquaculture), poids par espèce et **plages de numéros d'étiquettes des boîtes** — nombres, poids et étiquettes doivent correspondre exactement à tous les documents suivants. Validité : 6 mois environ. **La cohérence est vitale** : un chiffre discordant entre CITES, facture, liste de colisage ou certificat sanitaire bloque la douane.

### Étape 3 : encaisser l'acompte de 50 %

Scan CITES envoyé → virement de 50 % sous un jour ouvré. Coordonnées bancaires complètes (bénéficiaire, compte, banque, SWIFT) et **date de crédit en banque = date de paiement**.

### Étape 4 : production et gestion des lots

Production lancée après l'acompte. Code lot = code entreprise + date de production. Spécifications au dossier : sel 3,5 %, non pasteurisé, grain >3 mm, conservation -2 °C à 0 °C, DLC 60 jours. **Le compte à rebours de 60 jours démarre au jour de production.**

### Étape 5 : analyses par un laboratoire tiers

Laboratoire accrédité (≈5 jours). À tester : résidus vétérinaires (chloramphénicol, quatre métabolites de nitrofuranes, vert malachite, cristal violet — **tous « non détectés »**), métaux lourds, ABVT, flore totale, sensoriel. Ce rapport conditionne le certificat sanitaire et rassure l'acheteur.

### Étape 6 : inspection douanière — certificats sanitaire et vétérinaire

La douane locale délivre : le **certificat sanitaire** (aptitude officielle à la consommation humaine) et le **certificat de santé animale** (format UE FISH-CRUST-HC, signé par un vétérinaire officiel, aligné sur les règlements 852/2004 et 853/2004) — celui que contrôlent les vétérinaires aux frontières de l'UE.

### Étape 7 : solde et réservation du fret

Solde réglé avant expédition (« pas de solde, pas d'expédition »). Réservation aérienne ; la case Handling Information de la LTA doit porter **KEEP REFRIGERATED**, n° d'usine, n° de lot et date de production — le sol ne lit que cette ligne.

### Étape 8 : dédouanement export

Jeu documentaire : contrat, facture, liste de colisage, permis CITES **original**, certificats sanitaire et vétérinaire. Facture et liste de colisage doivent s'emboîter — lignes, prix, totaux, boîtes, cartons, poids, lot, usine — le tout conforme à la CITES.

### Étape 9 : dédouanement import (terrain de l'acheteur)

Confié au transitaire portuaire. Structure de coûts réelle : **droits ≈20 % (le gros poste)** | TRACES + dossier DSCE | contrôles vétérinaire et douanier au PCF | apurement du permis CITES d'import | entreposage congelé facturé au jour (**le dossier incomplet est l'erreur la plus chère**) | traduction assermentée | livraison frigorifique. Repère : les coûts d'import atteignent 25–35 % de la valeur marchandise — à intégrer au prix.

### Étape 10 : réception sous froid et clôture

Camion frigorifique jusqu'à la chambre froide ; laisser reposer les boîtes à l'arrivée. Vérifier boîtes vs plages d'étiquettes CITES, relevés de température, DLC restante. Litige → contre-analyse tierce ; sinon l'affaire est close. Archivage complet des deux côtés pendant 5 ans minimum.

### Liste des documents

| # | Document | Émis par |
|---|---|---|
| 1 | Facture commerciale (2 originaux) | Vendeur |
| 2 | Permis CITES d'exportation | Autorité CITES du pays d'export |
| 3 | Certificat d'origine | CCPIT / douane |
| 4 | Liste de colisage | Vendeur |
| 5 | Lettre de transport aérien | Compagnie aérienne |
| 6 | Certificat vétérinaire (santé animale) | Vétérinaire officiel |
| 7 | Certificat sanitaire | Douane |
| 8 | Rapport d'analyses tiers | Laboratoire accrédité |
| 9 | Permis CITES d'importation | **Acheteur**, dans le pays d'import |

## 3. La même affaire sur Oussouri Caviar HUB

La plateforme digitalise mise en relation, commande, séquestre, documents, traçabilité et suivi du froid. Trois règles : ① les contreparties ne voient que des codes plateforme — les identités réelles restent protégées ; ② les fonds restent sous séquestre et ne sont **libérés au vendeur qu'après confirmation de réception** ; ③ les originaux sont archivés par la plateforme — les contreparties reçoivent des copies caviardées.

### Parcours vendeur (9 étapes)

1. **Inscription** fournisseur ; validation par la plateforme (n° d'usine, agrément UE au dossier) ;
2. **Enregistrement des quotas CITES** — n° de permis, espèces, quota, validité ; suivi par espèce, déduction automatique à l'expédition, alerte avant échéance ;
3. **Chaîne de traçabilité** : unité de production → lot source → lot de transformation (n° réel + étapes) → contrôle qualité plateforme ;
4. **Mise en ligne** : catégorie/espèce/code SH → SKU (format, MOQ, DLC) → prix par paliers → validation et publication (traduction EN/FR automatique, relue) ;
5. **Stock** sous le lot de production réel, lié au lot de transformation ;
6. **Confirmation de commande** dès que les fonds sont sous séquestre ;
7. **Expédition et documents** : Incoterms, cartons, poids, segments de vol, puis chaque document avec numéro et dates. **Un contrôle de complétude bloque l'expédition s'il manque une pièce** ;
8. **Expédier** et consigner les températures — toute rupture alerte automatiquement ;
9. **Encaissement** : après la douane et la confirmation de l'acheteur, le séquestre se règle automatiquement, commission déduite.

### Parcours acheteur (9 étapes)

1. **Inscription** acheteur (importateur / grossiste / restauration) ;
2. **Comparaison** au marché : dossiers de traçabilité et agréments vérifiés (prix de gros visibles une fois connecté) ;
3. **Consultation** : petites quantités en direct ; gros volumes via **appel d'offres (RFQ)** ou négociation par un courtier de la plateforme ;
4. **Commande** depuis le panier ;
5. **Paiement sous séquestre** — l'argent va à la plateforme, pas au vendeur, jusqu'à votre confirmation ;
6. **Votre permis** : avec le scan CITES du vendeur (copie caviardée dans votre coffre documentaire), déposez la demande auprès de votre autorité CITES ;
7. **Suivi** en temps réel : états de commande, segments de vol, courbe de température ;
8. **Confirmation de réception** pour libérer le séquestre — ou litige dans le délai imparti : la plateforme gèle les fonds et arbitre ;
9. **Archives** : copies caviardées avec codes de suivi, disponibles pour vos futurs permis et audits.

## 4. Check-list anti-pièges

1. **Deux permis CITES** — export (vendeur) et import (acheteur), un par lot, validité ≈6 mois : planifiez à rebours ;
2. **Cohérence des chiffres** — poids, boîtes, lots, n° d'usine identiques au chiffre près sur tous les documents ;
3. **Compte à rebours DLC** — sur 60 jours, la vente n'en garde souvent que 30 à 40 ;
4. **Jalons de paiement fermes** — acompte lié au scan CITES, solde lié à l'expédition, date de crédit en banque faisant foi ;
5. **Coûts d'import** — 20 % de droits + contrôles + entreposage congelé + livraison froide : jusqu'à un tiers de la valeur ;
6. **L'entreposage brûle au jour** — un dossier incomplet coûte des centaines d'euros par jour de stockage congelé ;
7. **Langue et arbitrage** — contrat bilingue : désigner la version faisant foi et l'organe d'arbitrage ;
8. **Décharge qualité** — exsudation et salinité normales pour un caviar non pasteurisé : à écrire noir sur blanc.
`;

export const ACADEMY = {
  nav: { "zh-CN": "外贸学院", en: "Trade Academy", fr: "Académie" },
  title: { "zh-CN": "外贸学院 · 知识中心", en: "Trade Academy · Knowledge Hub", fr: "Académie · Centre de connaissances" },
  subtitle: {
    "zh-CN": "基于真实交易档案的鱼子酱进出口实操知识",
    en: "Hands-on caviar import/export knowledge built on real trade files",
    fr: "Savoir-faire import/export du caviar, fondé sur des dossiers réels",
  },
};

export const ARTICLES: AcademyArticle[] = [
  {
    slug: "caviar-trade-guide",
    title: {
      "zh-CN": "鱼子酱外贸进出口实操教程（新手版）",
      en: "The Caviar Import/Export Playbook (Beginner Edition)",
      fr: "Guide pratique de l'import/export de caviar (édition débutant)",
    },
    subtitle: {
      "zh-CN": "以一单真实完成的 50KG 输欧交易为教材：十步流程 + 单据清单 + 平台双侧操作 + 避坑清单",
      en: "Built on a real, completed 50 kg export to Europe: ten steps, document checklist, platform walkthroughs and pitfalls",
      fr: "Fondé sur une exportation réelle de 50 kg vers l'Europe : dix étapes, documents, parcours plateforme et pièges",
    },
    readMin: 15,
    body: { "zh-CN": ZH_BODY, en: EN_BODY, fr: FR_BODY },
  },
];

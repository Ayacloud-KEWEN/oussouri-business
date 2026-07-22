-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PENDING', 'PAID', 'WAIVED', 'OVERDUE');

-- AlterEnum
ALTER TYPE "OrderType" ADD VALUE 'SAMPLE';

-- AlterTable
ALTER TABLE "trade_orders" ADD COLUMN     "contractId" UUID;

-- CreateTable
CREATE TABLE "trade_contracts" (
    "id" UUID NOT NULL,
    "publicCode" TEXT NOT NULL,
    "contractNo" TEXT NOT NULL,
    "buyerOrgId" UUID NOT NULL,
    "supplierOrgId" UUID NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "totalQtyKg" DECIMAL(12,3),
    "tolerancePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(14,2),
    "incoterms" TEXT,
    "paymentTerms" JSONB,
    "signedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "trade_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_milestones" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "triggerNote" TEXT,
    "percentage" DECIMAL(5,2),
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "blocksShipment" BOOLEAN NOT NULL DEFAULT true,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PENDING',
    "paymentId" UUID,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payment_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cites_permit_lines" (
    "id" UUID NOT NULL,
    "permitId" UUID NOT NULL,
    "speciesCode" TEXT NOT NULL,
    "quotaKg" DECIMAL(12,3) NOT NULL,
    "usedKg" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "labelRange" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cites_permit_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trade_contracts_publicCode_key" ON "trade_contracts"("publicCode");

-- CreateIndex
CREATE INDEX "trade_contracts_buyerOrgId_status_idx" ON "trade_contracts"("buyerOrgId", "status");

-- CreateIndex
CREATE INDEX "trade_contracts_supplierOrgId_status_idx" ON "trade_contracts"("supplierOrgId", "status");

-- CreateIndex
CREATE INDEX "payment_milestones_orderId_status_idx" ON "payment_milestones"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_milestones_orderId_seq_key" ON "payment_milestones"("orderId", "seq");

-- CreateIndex
CREATE INDEX "cites_permit_lines_permitId_idx" ON "cites_permit_lines"("permitId");

-- CreateIndex
CREATE UNIQUE INDEX "cites_permit_lines_permitId_speciesCode_key" ON "cites_permit_lines"("permitId", "speciesCode");

-- CreateIndex
CREATE INDEX "trade_orders_contractId_idx" ON "trade_orders"("contractId");

-- AddForeignKey
ALTER TABLE "payment_milestones" ADD CONSTRAINT "payment_milestones_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "trade_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cites_permit_lines" ADD CONSTRAINT "cites_permit_lines_permitId_fkey" FOREIGN KEY ("permitId") REFERENCES "cites_permits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

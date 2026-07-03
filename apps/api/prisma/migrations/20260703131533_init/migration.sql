-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "analytics";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "audit";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "VisibilityEffect" AS ENUM ('ALLOW', 'MASK', 'DENY');

-- CreateEnum
CREATE TYPE "TranslationStatus" AS ENUM ('MACHINE_DRAFT', 'REVIEWED');

-- CreateEnum
CREATE TYPE "Sensitivity" AS ENUM ('LOW', 'HIGH');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'LOCKED', 'DISABLED');

-- CreateEnum
CREATE TYPE "DataScope" AS ENUM ('OWN', 'PARTY', 'ALL');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('SUPPLIER', 'BUYER', 'BOTH');

-- CreateEnum
CREATE TYPE "PartyStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BuyerType" AS ENUM ('WHOLESALER', 'RETAILER', 'RESTAURANT', 'IMPORTER', 'DISTRIBUTOR');

-- CreateEnum
CREATE TYPE "CertStatus" AS ENUM ('PENDING', 'VALID', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'INACTIVE', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "SkuStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO', 'DOC');

-- CreateEnum
CREATE TYPE "ActiveStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SourceBatchStatus" AS ENUM ('GROWING', 'HARVESTED', 'SOLD', 'CLOSED');

-- CreateEnum
CREATE TYPE "CareType" AS ENUM ('FEEDING', 'HEALTH', 'MEDICATION', 'MORTALITY');

-- CreateEnum
CREATE TYPE "QcStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'QC_PASS', 'QC_FAIL');

-- CreateEnum
CREATE TYPE "LotStatus" AS ENUM ('AVAILABLE', 'ON_HOLD', 'EXPIRED', 'SOLD_OUT');

-- CreateEnum
CREATE TYPE "InvTxType" AS ENUM ('INBOUND', 'RESERVE', 'RELEASE', 'OUTBOUND', 'ADJUST');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('DIRECT', 'AUCTION', 'RFQ', 'FUTURES', 'BROKER');

-- CreateEnum
CREATE TYPE "RfqScope" AS ENUM ('TARGETED', 'BROKERED');

-- CreateEnum
CREATE TYPE "AuctionType" AS ENUM ('ENGLISH', 'DUTCH', 'SEALED');

-- CreateEnum
CREATE TYPE "PayMethod" AS ENUM ('STRIPE_CARD', 'STRIPE_SEPA', 'WIRE_MANUAL');

-- CreateEnum
CREATE TYPE "PayStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'PARTIAL_REFUND');

-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('BUYER_FUNDS_IN_TRANSIT', 'ESCROW_HELD', 'PLATFORM_COMMISSION', 'SUPPLIER_PAYABLE', 'REFUND_PAYABLE', 'STRIPE_FEES');

-- CreateEnum
CREATE TYPE "EntryDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('PROFORMA', 'COMMERCIAL', 'PLATFORM_FEE');

-- CreateEnum
CREATE TYPE "TransportMode" AS ENUM ('AIR', 'SEA', 'ROAD', 'RAIL', 'COLD_CHAIN_LAST_MILE');

-- CreateEnum
CREATE TYPE "CustomsDirection" AS ENUM ('EXPORT', 'IMPORT');

-- CreateTable
CREATE TABLE "code_rules" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "seqLength" INTEGER NOT NULL DEFAULT 6,
    "jumpMax" INTEGER NOT NULL DEFAULT 7,
    "currentSeq" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "code_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visibility_policies" (
    "id" UUID NOT NULL,
    "resource" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contextRule" JSONB,
    "effect" "VisibilityEffect" NOT NULL,
    "maskPattern" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "visibility_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "state_machines" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "states" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "state_machines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "state_transitions" (
    "id" UUID NOT NULL,
    "machineCode" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "toState" TEXT NOT NULL,
    "allowedRoles" TEXT[],
    "guard" JSONB,
    "emitsEvent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "state_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_translations" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "status" "TranslationStatus" NOT NULL DEFAULT 'MACHINE_DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "entity_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_rates" (
    "id" UUID NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(12,6) NOT NULL,
    "source" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "id" UUID NOT NULL,
    "iso2" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "vatRate" DECIMAL(5,2),
    "euMember" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "config_entries" (
    "id" UUID NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "config_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregate" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" UUID,
    "diff" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_escalations" (
    "id" UUID NOT NULL,
    "requesterId" UUID NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" UUID NOT NULL,
    "fields" TEXT[],
    "reason" TEXT NOT NULL,
    "sensitivity" "Sensitivity" NOT NULL,
    "status" "EscalationStatus" NOT NULL DEFAULT 'PENDING',
    "approvedBy" UUID,
    "windowUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "access_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "emailEnc" BYTEA NOT NULL,
    "emailBidx" TEXT NOT NULL,
    "phoneEnc" BYTEA,
    "phoneBidx" TEXT,
    "passwordHash" TEXT,
    "displayName" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "totpSecretEnc" BYTEA,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUid" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "dataScope" "DataScope" NOT NULL DEFAULT 'OWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "publicCode" TEXT NOT NULL,
    "partyType" "PartyType" NOT NULL,
    "legalNameEnc" BYTEA NOT NULL,
    "legalNameBidx" TEXT NOT NULL,
    "registrationNoEnc" BYTEA,
    "taxIdEnc" BYTEA,
    "legalRepEnc" BYTEA,
    "addressEnc" BYTEA,
    "countryIso2" TEXT NOT NULL,
    "status" "PartyStatus" NOT NULL DEFAULT 'PENDING',
    "approvedBy" UUID,
    "approvedAt" TIMESTAMP(3),
    "riskNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "orgRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "nameEnc" BYTEA NOT NULL,
    "positionEnc" BYTEA,
    "phoneEnc" BYTEA,
    "emailEnc" BYTEA,
    "imEnc" BYTEA,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_profiles" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "establishedAt" TIMESTAMP(3),
    "registeredCapital" DECIMAL(14,2),
    "businessScope" TEXT,
    "tier" TEXT,
    "exportReady" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "supplier_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_profiles" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "buyerType" "BuyerType" NOT NULL,
    "city" TEXT,
    "creditScore" DECIMAL(5,1) NOT NULL DEFAULT 60,
    "totalPurchases" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "churnRiskAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "buyer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "recipientEnc" BYTEA NOT NULL,
    "phoneEnc" BYTEA NOT NULL,
    "line1Enc" BYTEA NOT NULL,
    "cityEnc" BYTEA NOT NULL,
    "postcode" TEXT,
    "countryIso2" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_certificates" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "certType" TEXT NOT NULL,
    "certNo" TEXT NOT NULL,
    "issuer" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "fileKey" TEXT,
    "status" "CertStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "party_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "parentId" UUID,
    "industryTemplate" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "species" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "latinName" TEXT NOT NULL,
    "citesAppendix" TEXT,
    "fatherCode" TEXT,
    "motherCode" TEXT,
    "maturityYears" TEXT,
    "avgEggSizeMm" DECIMAL(4,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "species_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grades" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "criteria" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "grades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "publicCode" TEXT NOT NULL,
    "supplierOrgId" UUID NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "speciesCode" TEXT,
    "gradeCode" TEXT,
    "hsCode" TEXT NOT NULL,
    "originCountry" TEXT NOT NULL,
    "originDetailEnc" BYTEA,
    "sourceLocale" TEXT NOT NULL DEFAULT 'zh-CN',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_skus" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "skuCode" TEXT NOT NULL,
    "packSpec" TEXT NOT NULL,
    "netWeightKg" DECIMAL(12,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "moq" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "shelfLifeDays" INTEGER,
    "storageTempMin" DECIMAL(4,1),
    "storageTempMax" DECIMAL(4,1),
    "status" "SkuStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_tiers" (
    "id" UUID NOT NULL,
    "skuId" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "qtyMin" DECIMAL(10,2) NOT NULL,
    "qtyMax" DECIMAL(10,2),
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "fileKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_units" (
    "id" UUID NOT NULL,
    "supplierOrgId" UUID NOT NULL,
    "unitType" TEXT NOT NULL,
    "nameEnc" BYTEA NOT NULL,
    "locationEnc" BYTEA NOT NULL,
    "countryIso2" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "status" "ActiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "production_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_subunits" (
    "id" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "production_subunits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_batches" (
    "id" UUID NOT NULL,
    "subunitId" UUID NOT NULL,
    "batchNo" TEXT NOT NULL,
    "speciesCode" TEXT,
    "quantity" INTEGER,
    "avgWeightKg" DECIMAL(8,2),
    "ageMonths" INTEGER,
    "originType" TEXT,
    "rfidStart" TEXT,
    "rfidEnd" TEXT,
    "status" "SourceBatchStatus" NOT NULL DEFAULT 'GROWING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "source_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "individual_assets" (
    "id" UUID NOT NULL,
    "sourceBatchId" UUID NOT NULL,
    "rfid" TEXT NOT NULL,
    "gender" TEXT,
    "birthDate" TIMESTAMP(3),
    "weightKg" DECIMAL(8,2),
    "lengthCm" DECIMAL(6,2),
    "healthStatus" TEXT NOT NULL DEFAULT 'HEALTHY',
    "status" TEXT NOT NULL DEFAULT 'ALIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "individual_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_records" (
    "id" UUID NOT NULL,
    "sourceBatchId" UUID NOT NULL,
    "recordType" "CareType" NOT NULL,
    "recordDate" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "withdrawalUntil" TIMESTAMP(3),
    "operator" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "care_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_batches" (
    "id" UUID NOT NULL,
    "supplierOrgId" UUID NOT NULL,
    "sourceBatchId" UUID,
    "batchNo" TEXT NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "speciesCode" TEXT,
    "rawWeightKg" DECIMAL(12,3) NOT NULL,
    "outputWeightKg" DECIMAL(12,3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL,
    "attributes" JSONB NOT NULL,
    "qcStatus" "QcStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "processing_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_steps" (
    "id" UUID NOT NULL,
    "processingBatchId" UUID NOT NULL,
    "stepCode" TEXT NOT NULL,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "temperature" DECIMAL(4,1),
    "operator" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "processing_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_lots" (
    "id" UUID NOT NULL,
    "skuId" UUID NOT NULL,
    "processingBatchId" UUID,
    "lotNo" TEXT NOT NULL,
    "producedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "warehouse" TEXT,
    "storageTemp" DECIMAL(4,1),
    "qtyOnHand" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "qtyReserved" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "status" "LotStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "inventory_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "txType" "InvTxType" NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "refType" TEXT,
    "refId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "refType" TEXT NOT NULL,
    "refId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "status" "ReservationStatus" NOT NULL DEFAULT 'HELD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "buyerOrgId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "skuId" UUID NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_orders" (
    "id" UUID NOT NULL,
    "publicCode" TEXT NOT NULL,
    "orderType" "OrderType" NOT NULL,
    "buyerOrgId" UUID NOT NULL,
    "supplierOrgId" UUID NOT NULL,
    "brokerUserId" UUID,
    "currency" TEXT NOT NULL,
    "fxRateToEur" DECIMAL(12,6) NOT NULL,
    "itemsTotal" DECIMAL(14,2) NOT NULL,
    "commissionRate" DECIMAL(5,4) NOT NULL,
    "commissionAmount" DECIMAL(14,2) NOT NULL,
    "grandTotal" DECIMAL(14,2) NOT NULL,
    "status" TEXT NOT NULL,
    "shippingAddressId" UUID,
    "incoterms" TEXT,
    "disputeUntil" TIMESTAMP(3),
    "placedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "trade_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "skuId" UUID NOT NULL,
    "lotId" UUID,
    "qty" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfqs" (
    "id" UUID NOT NULL,
    "publicCode" TEXT NOT NULL,
    "buyerOrgId" UUID NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "speciesCode" TEXT,
    "gradeCode" TEXT,
    "packSpec" TEXT,
    "qty" DECIMAL(10,2) NOT NULL,
    "targetPrice" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "destCountry" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "scope" "RfqScope" NOT NULL DEFAULT 'BROKERED',
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "rfqId" UUID NOT NULL,
    "supplierOrgId" UUID NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "moq" DECIMAL(10,2),
    "leadTimeDays" INTEGER,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auctions" (
    "id" UUID NOT NULL,
    "publicCode" TEXT NOT NULL,
    "skuId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "supplierOrgId" UUID NOT NULL,
    "auctionType" "AuctionType" NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL,
    "startPrice" DECIMAL(14,2) NOT NULL,
    "reservePrice" DECIMAL(14,2),
    "bidIncrement" DECIMAL(14,2) NOT NULL,
    "depositAmount" DECIMAL(14,2) NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "antiSnipeMin" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "auctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_participants" (
    "id" UUID NOT NULL,
    "auctionId" UUID NOT NULL,
    "buyerOrgId" UUID NOT NULL,
    "paddleNo" TEXT NOT NULL,
    "depositPaymentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "auction_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_bids" (
    "id" UUID NOT NULL,
    "auctionId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "isProxy" BOOLEAN NOT NULL DEFAULT false,
    "maxProxyAmount" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auction_bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "futures_contracts" (
    "id" UUID NOT NULL,
    "publicCode" TEXT NOT NULL,
    "supplierOrgId" UUID NOT NULL,
    "skuId" UUID NOT NULL,
    "estimatedQty" DECIMAL(10,2) NOT NULL,
    "lockedPrice" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "depositPct" DECIMAL(5,2) NOT NULL,
    "deliveryFrom" TIMESTAMP(3) NOT NULL,
    "deliveryTo" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "futures_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "futures_subscriptions" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "buyerOrgId" UUID NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL,
    "depositPaymentId" UUID,
    "confirmedQty" DECIMAL(10,2),
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "futures_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "raisedByOrgId" UUID NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "resolution" JSONB,
    "resolvedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_accounts" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "onboardingStatus" TEXT NOT NULL,
    "defaultCurrency" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stripe_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "orderId" UUID,
    "refType" TEXT NOT NULL,
    "refId" UUID NOT NULL,
    "method" "PayMethod" NOT NULL,
    "stripePaymentIntentId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "PayStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "wireProofKey" TEXT,
    "reconciledBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "stripeTransferId" TEXT,
    "supplierOrgId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "stripeRefundId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "journalId" UUID NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "orgId" UUID,
    "orderId" UUID,
    "direction" "EntryDirection" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL,
    "categoryCode" TEXT,
    "orderType" "OrderType",
    "supplierTier" TEXT,
    "ratePct" DECIMAL(5,4) NOT NULL,
    "brokerFeePct" DECIMAL(5,4),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "publicCode" TEXT NOT NULL,
    "orderId" UUID NOT NULL,
    "kind" "InvoiceKind" NOT NULL,
    "issuedTo" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "vatAmount" DECIMAL(14,2),
    "fileKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "incoterms" TEXT,
    "packages" INTEGER,
    "grossWeightKg" DECIMAL(12,3),
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_legs" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "mode" "TransportMode" NOT NULL,
    "carrier" TEXT NOT NULL,
    "waybillNo" TEXT,
    "fromCode" TEXT NOT NULL,
    "toCode" TEXT NOT NULL,
    "departAt" TIMESTAMP(3),
    "arriveAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "shipment_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "temperature_logs" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "tempC" DECIMAL(5,2) NOT NULL,
    "source" TEXT NOT NULL,
    "breached" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "temperature_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customs_declarations" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "direction" "CustomsDirection" NOT NULL,
    "declarationNo" TEXT,
    "brokerName" TEXT,
    "hsCode" TEXT NOT NULL,
    "declaredValue" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "dutyAmount" DECIMAL(14,2),
    "vatAmount" DECIMAL(14,2),
    "declaredAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "inspectionResult" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "customs_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cites_permits" (
    "id" UUID NOT NULL,
    "supplierOrgId" UUID NOT NULL,
    "permitNo" TEXT NOT NULL,
    "speciesCode" TEXT NOT NULL,
    "quotaKg" DECIMAL(12,3) NOT NULL,
    "usedKg" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "status" "CertStatus" NOT NULL DEFAULT 'VALID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cites_permits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "docType" TEXT NOT NULL,
    "docNo" TEXT,
    "ownerOrgId" UUID,
    "refType" TEXT,
    "refId" UUID,
    "issuer" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "fileKey" TEXT NOT NULL,
    "maskTemplate" JSONB,
    "status" "CertStatus" NOT NULL DEFAULT 'VALID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "masked_document_copies" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "trackingCode" TEXT NOT NULL,
    "generatedBy" UUID NOT NULL,
    "sentToOrgId" UUID NOT NULL,
    "fileKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "masked_document_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_requirement_templates" (
    "id" UUID NOT NULL,
    "categoryCode" TEXT NOT NULL,
    "exportCountry" TEXT NOT NULL,
    "importCountry" TEXT NOT NULL,
    "requiredDocTypes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "doc_requirement_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics"."behavior_events" (
    "id" BIGSERIAL NOT NULL,
    "orgId" UUID,
    "userId" UUID,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "behavior_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demand_profiles" (
    "id" UUID NOT NULL,
    "buyerOrgId" UUID NOT NULL,
    "preferences" JSONB NOT NULL,
    "lastOrderAt" TIMESTAMP(3),
    "computedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "demand_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lois" (
    "id" UUID NOT NULL,
    "buyerOrgId" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "validUntil" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lois_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" UUID NOT NULL,
    "publicCode" TEXT NOT NULL,
    "buyerOrgId" UUID NOT NULL,
    "supplierOrgId" UUID NOT NULL,
    "lotId" UUID,
    "skuId" UUID,
    "sourceSignal" TEXT NOT NULL,
    "matchingScore" DECIMAL(5,2) NOT NULL,
    "opportunityScore" DECIMAL(5,2) NOT NULL,
    "urgencyScore" DECIMAL(5,2) NOT NULL,
    "profitScore" DECIMAL(5,2) NOT NULL,
    "explanation" JSONB NOT NULL,
    "assignedBrokerId" UUID,
    "status" TEXT NOT NULL,
    "lostReason" TEXT,
    "wonOrderId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_activities" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "activityType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,

    CONSTRAINT "opportunity_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_logs" (
    "id" UUID NOT NULL,
    "brokerUserId" UUID NOT NULL,
    "targetOrgId" UUID NOT NULL,
    "opportunityId" UUID,
    "providerCallId" TEXT,
    "startedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "outcome" TEXT,
    "recordingKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "topicType" TEXT NOT NULL,
    "topicId" UUID,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "orgId" UUID,
    "userId" UUID NOT NULL,
    "partRole" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderUserId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "translatedBody" JSONB,
    "readBy" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit"."message_block_events" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "conversationId" UUID,
    "matchedRule" TEXT NOT NULL,
    "rawExcerpt" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_block_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "channels" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "templateCode" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "templateCode" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_embeddings" (
    "skuId" UUID NOT NULL,
    "contentHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_embeddings_pkey" PRIMARY KEY ("skuId")
);

-- CreateTable
CREATE TABLE "demand_embeddings" (
    "buyerOrgId" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demand_embeddings_pkey" PRIMARY KEY ("buyerOrgId")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "docKind" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "fileKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" UUID,
    "updatedBy" UUID,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics"."llm_call_logs" (
    "id" UUID NOT NULL,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL,
    "tokensOut" INTEGER NOT NULL,
    "costEur" DECIMAL(10,6),
    "latencyMs" INTEGER NOT NULL,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "code_rules_entityType_key" ON "code_rules"("entityType");

-- CreateIndex
CREATE UNIQUE INDEX "visibility_policies_resource_field_role_key" ON "visibility_policies"("resource", "field", "role");

-- CreateIndex
CREATE UNIQUE INDEX "state_machines_code_key" ON "state_machines"("code");

-- CreateIndex
CREATE UNIQUE INDEX "state_transitions_machineCode_fromState_toState_key" ON "state_transitions"("machineCode", "fromState", "toState");

-- CreateIndex
CREATE INDEX "entity_translations_entityType_entityId_idx" ON "entity_translations"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "entity_translations_status_idx" ON "entity_translations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "entity_translations_entityType_entityId_field_locale_key" ON "entity_translations"("entityType", "entityId", "field", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_base_quote_asOf_key" ON "exchange_rates"("base", "quote", "asOf");

-- CreateIndex
CREATE UNIQUE INDEX "countries_iso2_key" ON "countries"("iso2");

-- CreateIndex
CREATE UNIQUE INDEX "config_entries_namespace_key_key" ON "config_entries"("namespace", "key");

-- CreateIndex
CREATE INDEX "outbox_events_publishedAt_createdAt_idx" ON "outbox_events"("publishedAt", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_occurredAt_idx" ON "audit"."audit_logs"("actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_occurredAt_idx" ON "audit"."audit_logs"("targetType", "targetId", "occurredAt");

-- CreateIndex
CREATE INDEX "access_escalations_status_createdAt_idx" ON "access_escalations"("status", "createdAt");

-- CreateIndex
CREATE INDEX "access_escalations_requesterId_createdAt_idx" ON "access_escalations"("requesterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_emailBidx_key" ON "users"("emailBidx");

-- CreateIndex
CREATE INDEX "users_phoneBidx_idx" ON "users"("phoneBidx");

-- CreateIndex
CREATE INDEX "oauth_accounts_userId_idx" ON "oauth_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_providerUid_key" ON "oauth_accounts"("provider", "providerUid");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "role_permissions_roleId_permissionId_key" ON "role_permissions"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "user_roles"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshHash_key" ON "sessions"("refreshHash");

-- CreateIndex
CREATE INDEX "sessions_userId_expiresAt_idx" ON "sessions"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_publicCode_key" ON "organizations"("publicCode");

-- CreateIndex
CREATE INDEX "organizations_legalNameBidx_idx" ON "organizations"("legalNameBidx");

-- CreateIndex
CREATE INDEX "organizations_partyType_status_idx" ON "organizations"("partyType", "status");

-- CreateIndex
CREATE INDEX "memberships_orgId_idx" ON "memberships"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_userId_orgId_key" ON "memberships"("userId", "orgId");

-- CreateIndex
CREATE INDEX "contacts_orgId_idx" ON "contacts"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_profiles_orgId_key" ON "supplier_profiles"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_profiles_orgId_key" ON "buyer_profiles"("orgId");

-- CreateIndex
CREATE INDEX "addresses_orgId_idx" ON "addresses"("orgId");

-- CreateIndex
CREATE INDEX "party_certificates_orgId_certType_idx" ON "party_certificates"("orgId", "certType");

-- CreateIndex
CREATE INDEX "party_certificates_expiryDate_idx" ON "party_certificates"("expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "categories_code_key" ON "categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "species_code_key" ON "species"("code");

-- CreateIndex
CREATE UNIQUE INDEX "grades_code_key" ON "grades"("code");

-- CreateIndex
CREATE UNIQUE INDEX "products_publicCode_key" ON "products"("publicCode");

-- CreateIndex
CREATE INDEX "products_categoryCode_speciesCode_gradeCode_status_idx" ON "products"("categoryCode", "speciesCode", "gradeCode", "status");

-- CreateIndex
CREATE INDEX "products_supplierOrgId_status_idx" ON "products"("supplierOrgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_skus_skuCode_key" ON "product_skus"("skuCode");

-- CreateIndex
CREATE INDEX "product_skus_productId_idx" ON "product_skus"("productId");

-- CreateIndex
CREATE INDEX "price_tiers_skuId_currency_isActive_idx" ON "price_tiers"("skuId", "currency", "isActive");

-- CreateIndex
CREATE INDEX "product_media_productId_idx" ON "product_media"("productId");

-- CreateIndex
CREATE INDEX "production_units_supplierOrgId_idx" ON "production_units"("supplierOrgId");

-- CreateIndex
CREATE INDEX "production_subunits_unitId_idx" ON "production_subunits"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "source_batches_subunitId_batchNo_key" ON "source_batches"("subunitId", "batchNo");

-- CreateIndex
CREATE UNIQUE INDEX "individual_assets_rfid_key" ON "individual_assets"("rfid");

-- CreateIndex
CREATE INDEX "individual_assets_sourceBatchId_idx" ON "individual_assets"("sourceBatchId");

-- CreateIndex
CREATE INDEX "care_records_sourceBatchId_recordType_recordDate_idx" ON "care_records"("sourceBatchId", "recordType", "recordDate");

-- CreateIndex
CREATE UNIQUE INDEX "processing_batches_supplierOrgId_batchNo_key" ON "processing_batches"("supplierOrgId", "batchNo");

-- CreateIndex
CREATE INDEX "processing_steps_processingBatchId_idx" ON "processing_steps"("processingBatchId");

-- CreateIndex
CREATE INDEX "inventory_lots_expiresAt_status_idx" ON "inventory_lots"("expiresAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_lots_skuId_lotNo_key" ON "inventory_lots"("skuId", "lotNo");

-- CreateIndex
CREATE INDEX "inventory_transactions_lotId_createdAt_idx" ON "inventory_transactions"("lotId", "createdAt");

-- CreateIndex
CREATE INDEX "reservations_expiresAt_status_idx" ON "reservations"("expiresAt", "status");

-- CreateIndex
CREATE INDEX "reservations_refType_refId_idx" ON "reservations"("refType", "refId");

-- CreateIndex
CREATE UNIQUE INDEX "carts_buyerOrgId_key" ON "carts"("buyerOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_skuId_key" ON "cart_items"("cartId", "skuId");

-- CreateIndex
CREATE UNIQUE INDEX "trade_orders_publicCode_key" ON "trade_orders"("publicCode");

-- CreateIndex
CREATE INDEX "trade_orders_buyerOrgId_status_idx" ON "trade_orders"("buyerOrgId", "status");

-- CreateIndex
CREATE INDEX "trade_orders_supplierOrgId_status_idx" ON "trade_orders"("supplierOrgId", "status");

-- CreateIndex
CREATE INDEX "trade_orders_brokerUserId_idx" ON "trade_orders"("brokerUserId");

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "rfqs_publicCode_key" ON "rfqs"("publicCode");

-- CreateIndex
CREATE INDEX "rfqs_buyerOrgId_status_idx" ON "rfqs"("buyerOrgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_rfqId_supplierOrgId_round_key" ON "quotes"("rfqId", "supplierOrgId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "auctions_publicCode_key" ON "auctions"("publicCode");

-- CreateIndex
CREATE INDEX "auctions_status_startAt_idx" ON "auctions"("status", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "auction_participants_auctionId_buyerOrgId_key" ON "auction_participants"("auctionId", "buyerOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "auction_participants_auctionId_paddleNo_key" ON "auction_participants"("auctionId", "paddleNo");

-- CreateIndex
CREATE INDEX "auction_bids_auctionId_amount_idx" ON "auction_bids"("auctionId", "amount");

-- CreateIndex
CREATE UNIQUE INDEX "futures_contracts_publicCode_key" ON "futures_contracts"("publicCode");

-- CreateIndex
CREATE INDEX "futures_subscriptions_contractId_idx" ON "futures_subscriptions"("contractId");

-- CreateIndex
CREATE INDEX "disputes_orderId_idx" ON "disputes"("orderId");

-- CreateIndex
CREATE INDEX "disputes_status_idx" ON "disputes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_accounts_orgId_key" ON "stripe_accounts"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "stripe_accounts_stripeAccountId_key" ON "stripe_accounts"("stripeAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripePaymentIntentId_key" ON "payments"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "payments_refType_refId_idx" ON "payments"("refType", "refId");

-- CreateIndex
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_stripeTransferId_key" ON "transfers"("stripeTransferId");

-- CreateIndex
CREATE INDEX "transfers_orderId_idx" ON "transfers"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_stripeRefundId_key" ON "refunds"("stripeRefundId");

-- CreateIndex
CREATE INDEX "refunds_paymentId_idx" ON "refunds"("paymentId");

-- CreateIndex
CREATE INDEX "ledger_entries_orderId_idx" ON "ledger_entries"("orderId");

-- CreateIndex
CREATE INDEX "ledger_entries_account_createdAt_idx" ON "ledger_entries"("account", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_journalId_idx" ON "ledger_entries"("journalId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_publicCode_key" ON "invoices"("publicCode");

-- CreateIndex
CREATE INDEX "invoices_orderId_idx" ON "invoices"("orderId");

-- CreateIndex
CREATE INDEX "shipments_orderId_idx" ON "shipments"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_legs_shipmentId_seq_key" ON "shipment_legs"("shipmentId", "seq");

-- CreateIndex
CREATE INDEX "temperature_logs_shipmentId_recordedAt_idx" ON "temperature_logs"("shipmentId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "customs_declarations_orderId_direction_key" ON "customs_declarations"("orderId", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "cites_permits_permitNo_key" ON "cites_permits"("permitNo");

-- CreateIndex
CREATE INDEX "cites_permits_expiryDate_idx" ON "cites_permits"("expiryDate");

-- CreateIndex
CREATE INDEX "cites_permits_supplierOrgId_idx" ON "cites_permits"("supplierOrgId");

-- CreateIndex
CREATE INDEX "documents_refType_refId_idx" ON "documents"("refType", "refId");

-- CreateIndex
CREATE INDEX "documents_ownerOrgId_docType_idx" ON "documents"("ownerOrgId", "docType");

-- CreateIndex
CREATE UNIQUE INDEX "masked_document_copies_trackingCode_key" ON "masked_document_copies"("trackingCode");

-- CreateIndex
CREATE INDEX "masked_document_copies_documentId_idx" ON "masked_document_copies"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "doc_requirement_templates_categoryCode_exportCountry_import_key" ON "doc_requirement_templates"("categoryCode", "exportCountry", "importCountry");

-- CreateIndex
CREATE INDEX "behavior_events_orgId_eventType_occurredAt_idx" ON "analytics"."behavior_events"("orgId", "eventType", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "demand_profiles_buyerOrgId_key" ON "demand_profiles"("buyerOrgId");

-- CreateIndex
CREATE INDEX "lois_buyerOrgId_status_idx" ON "lois"("buyerOrgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_publicCode_key" ON "opportunities"("publicCode");

-- CreateIndex
CREATE INDEX "opportunities_status_urgencyScore_idx" ON "opportunities"("status", "urgencyScore");

-- CreateIndex
CREATE INDEX "opportunities_assignedBrokerId_status_idx" ON "opportunities"("assignedBrokerId", "status");

-- CreateIndex
CREATE INDEX "opportunity_activities_opportunityId_createdAt_idx" ON "opportunity_activities"("opportunityId", "createdAt");

-- CreateIndex
CREATE INDEX "call_logs_brokerUserId_createdAt_idx" ON "call_logs"("brokerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "conversations_topicType_topicId_idx" ON "conversations"("topicType", "topicId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_participants_conversationId_userId_key" ON "conversation_participants"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "message_block_events_userId_occurredAt_idx" ON "audit"."message_block_events"("userId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_code_key" ON "notification_templates"("code");

-- CreateIndex
CREATE INDEX "notifications_userId_status_idx" ON "notifications"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_templateCode_channel_key" ON "notification_preferences"("userId", "templateCode", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_documentId_seq_key" ON "knowledge_chunks"("documentId", "seq");

-- CreateIndex
CREATE INDEX "llm_call_logs_task_createdAt_idx" ON "analytics"."llm_call_logs"("task", "createdAt");

-- AddForeignKey
ALTER TABLE "state_transitions" ADD CONSTRAINT "state_transitions_machineCode_fkey" FOREIGN KEY ("machineCode") REFERENCES "state_machines"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_certificates" ADD CONSTRAINT "party_certificates_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_skus" ADD CONSTRAINT "product_skus_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "product_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processing_steps" ADD CONSTRAINT "processing_steps_processingBatchId_fkey" FOREIGN KEY ("processingBatchId") REFERENCES "processing_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "trade_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_participants" ADD CONSTRAINT "auction_participants_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_bids" ADD CONSTRAINT "auction_bids_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "auctions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_legs" ADD CONSTRAINT "shipment_legs_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "masked_document_copies" ADD CONSTRAINT "masked_document_copies_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_activities" ADD CONSTRAINT "opportunity_activities_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

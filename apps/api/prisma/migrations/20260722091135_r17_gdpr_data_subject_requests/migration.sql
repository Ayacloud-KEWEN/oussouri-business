-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "requestType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "handledBy" UUID,
    "handledAt" TIMESTAMP(3),
    "resultFileKey" TEXT,
    "tokenHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "erasureReport" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_subject_requests_tokenHash_key" ON "data_subject_requests"("tokenHash");

-- CreateIndex
CREATE INDEX "data_subject_requests_userId_status_idx" ON "data_subject_requests"("userId", "status");

-- CreateIndex
CREATE INDEX "data_subject_requests_status_createdAt_idx" ON "data_subject_requests"("status", "createdAt");

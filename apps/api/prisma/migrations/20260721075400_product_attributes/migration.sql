-- DropIndex
DROP INDEX "products_name_trgm_idx";

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "attributes" JSONB;

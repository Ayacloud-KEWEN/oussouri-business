-- 产品全文/模糊搜索索引（R2）
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "products_fts_idx" ON "core"."products"
  USING GIN (to_tsvector('simple', coalesce("name", '') || ' ' || coalesce("description", '')));

CREATE INDEX IF NOT EXISTS "products_name_trgm_idx" ON "core"."products"
  USING GIN ("name" gin_trgm_ops);

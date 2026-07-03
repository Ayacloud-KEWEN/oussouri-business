-- 超卖兜底约束（Step 4 §7）：余额与预留永不为负，预留不超过在库
ALTER TABLE "core"."inventory_lots"
  ADD CONSTRAINT "inventory_lots_qty_check"
  CHECK ("qtyOnHand" >= 0 AND "qtyReserved" >= 0 AND "qtyReserved" <= "qtyOnHand");

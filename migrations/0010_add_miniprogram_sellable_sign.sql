-- Migration number: 0010
ALTER TABLE miniprogram_sellable_products
ADD COLUMN sign TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_miniprogram_sellable_products_sign
    ON miniprogram_sellable_products(sign);

CREATE INDEX IF NOT EXISTS idx_miniprogram_sellable_products_id_sign
    ON miniprogram_sellable_products(id, sign);

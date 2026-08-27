-- Migration number: 0011
ALTER TABLE miniprogram_sellable_products
ADD COLUMN actual_cafe_ku_id TEXT;

ALTER TABLE miniprogram_sellable_products
ADD COLUMN actual_coffee_card_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_miniprogram_sellables_actual_card
    ON miniprogram_sellable_products(actual_coffee_card_id, is_delete, status);

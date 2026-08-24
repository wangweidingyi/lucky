-- Migration number: 0003
ALTER TABLE lucky_sellable_products RENAME TO lucky_sellable_products_old;

CREATE TABLE lucky_sellable_products (
    id TEXT PRIMARY KEY NOT NULL,
    sellable_product_ids TEXT NOT NULL,
    sellable_sku_codes TEXT NOT NULL,
    sellable_quantity INTEGER NOT NULL DEFAULT 1 CHECK (sellable_quantity > 0),
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'done')),
    order_user_id TEXT NOT NULL,
    third_party_remark_id TEXT CHECK (
        third_party_remark_id IS NULL
        OR third_party_remark_id GLOB '[0-9A-Za-z][0-9A-Za-z][0-9A-Za-z]'
    ),
    third_party_order_id TEXT,
    third_party_product_id TEXT,
    is_delete INTEGER NOT NULL DEFAULT 0 CHECK (is_delete IN (0, 1)),
    FOREIGN KEY (order_user_id) REFERENCES lucky_order_users(id)
);

INSERT INTO lucky_sellable_products (
    id,
    sellable_product_ids,
    sellable_sku_codes,
    sellable_quantity,
    status,
    order_user_id,
    third_party_remark_id,
    third_party_order_id,
    third_party_product_id,
    is_delete
)
SELECT
    id,
    sellable_product_ids,
    sellable_sku_codes,
    sellable_quantity,
    status,
    order_user_id,
    third_party_remark_id,
    third_party_order_id,
    third_party_product_id,
    is_delete
FROM lucky_sellable_products_old;

DROP TABLE lucky_sellable_products_old;

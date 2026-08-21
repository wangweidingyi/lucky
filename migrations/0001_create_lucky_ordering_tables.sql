-- Migration number: 0001
CREATE TABLE IF NOT EXISTS lucky_order_users (
    id TEXT PRIMARY KEY NOT NULL,
    nickname TEXT NOT NULL,
    token TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'lucky',
    status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
    is_delete INTEGER NOT NULL DEFAULT 0 CHECK (is_delete IN (0, 1))
);

CREATE TABLE IF NOT EXISTS lucky_sellable_products (
    id TEXT PRIMARY KEY NOT NULL,
    sellable_product_ids TEXT NOT NULL,
    sellable_sku_codes TEXT NOT NULL,
    sellable_quantity INTEGER NOT NULL DEFAULT 1 CHECK (sellable_quantity > 0),
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

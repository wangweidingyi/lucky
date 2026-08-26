-- Migration number: 0008
CREATE TABLE IF NOT EXISTS miniprogram_order_users (
    id TEXT PRIMARY KEY NOT NULL,
    nickname TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
    uid TEXT NOT NULL,
    openid TEXT,
    black_box TEXT,
    notify_code TEXT,
    csid TEXT,
    pay_type TEXT,
    miniprogram_version TEXT NOT NULL DEFAULT '5587',
    aes_key TEXT NOT NULL DEFAULT 'CJQjAc1hYieC4QYb',
    base_url TEXT NOT NULL DEFAULT 'https://capi.lkcoffee.com',
    cookie TEXT,
    is_delete INTEGER NOT NULL DEFAULT 0 CHECK (is_delete IN (0, 1))
);

CREATE TABLE IF NOT EXISTS miniprogram_coffee_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_user_id TEXT NOT NULL,
    cafe_ku_id TEXT NOT NULL,
    coupon_no TEXT,
    coffee_voucher_type INTEGER NOT NULL DEFAULT 0,
    card_name TEXT,
    usable_quantity INTEGER NOT NULL DEFAULT 1 CHECK (usable_quantity >= 0),
    generated_sellable_count INTEGER NOT NULL DEFAULT 0 CHECK (generated_sellable_count >= 0),
    last_synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    raw TEXT NOT NULL DEFAULT '{}',
    is_delete INTEGER NOT NULL DEFAULT 0 CHECK (is_delete IN (0, 1)),
    UNIQUE (order_user_id, cafe_ku_id),
    FOREIGN KEY (order_user_id) REFERENCES miniprogram_order_users(id)
);

CREATE TABLE IF NOT EXISTS miniprogram_sellable_products (
    id TEXT PRIMARY KEY NOT NULL,
    coffee_card_id INTEGER NOT NULL,
    sellable_quantity INTEGER NOT NULL DEFAULT 1 CHECK (sellable_quantity = 1),
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'done')),
    order_user_id TEXT NOT NULL,
    third_party_remark_id TEXT CHECK (
        third_party_remark_id IS NULL
        OR third_party_remark_id GLOB '[0-9A-Za-z][0-9A-Za-z][0-9A-Za-z]'
    ),
    luckin_order_id TEXT,
    selected_product_id INTEGER,
    selected_sku_code TEXT,
    selected_product_name TEXT,
    ordered_at TEXT,
    is_delete INTEGER NOT NULL DEFAULT 0 CHECK (is_delete IN (0, 1)),
    FOREIGN KEY (coffee_card_id) REFERENCES miniprogram_coffee_cards(id),
    FOREIGN KEY (order_user_id) REFERENCES miniprogram_order_users(id)
);

CREATE INDEX IF NOT EXISTS idx_miniprogram_cards_order_user
    ON miniprogram_coffee_cards(order_user_id, is_delete);

CREATE INDEX IF NOT EXISTS idx_miniprogram_sellables_card
    ON miniprogram_sellable_products(coffee_card_id, is_delete, status);

CREATE INDEX IF NOT EXISTS idx_miniprogram_sellables_order_user
    ON miniprogram_sellable_products(order_user_id, is_delete, status);

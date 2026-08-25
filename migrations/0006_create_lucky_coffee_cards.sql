-- Migration number: 0006
CREATE TABLE IF NOT EXISTS lucky_coffee_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_user_id TEXT NOT NULL,
    cafe_ku_id TEXT NOT NULL,
    coupon_no TEXT,
    coffee_voucher_type INTEGER NOT NULL DEFAULT 0,
    card_name TEXT,
    usable_quantity INTEGER NOT NULL DEFAULT 1 CHECK (usable_quantity >= 0),
    synced_product_count INTEGER NOT NULL DEFAULT 0 CHECK (synced_product_count >= 0),
    generated_sellable_count INTEGER NOT NULL DEFAULT 0 CHECK (generated_sellable_count >= 0),
    last_synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    raw TEXT NOT NULL DEFAULT '{}',
    is_delete INTEGER NOT NULL DEFAULT 0 CHECK (is_delete IN (0, 1)),
    UNIQUE (order_user_id, cafe_ku_id),
    FOREIGN KEY (order_user_id) REFERENCES lucky_order_users(id)
);

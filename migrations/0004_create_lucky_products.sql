-- Migration number: 0004
CREATE TABLE IF NOT EXISTS lucky_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    sku_code TEXT NOT NULL,
    product_name TEXT NOT NULL,
    picture_url TEXT,
    initial_price REAL,
    estimate_price REAL,
    tags TEXT NOT NULL DEFAULT '[]',
    attrs TEXT NOT NULL DEFAULT '[]',
    raw TEXT NOT NULL DEFAULT '{}',
    source_query TEXT,
    last_synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_delete INTEGER NOT NULL DEFAULT 0 CHECK (is_delete IN (0, 1)),
    UNIQUE (product_id, sku_code)
);


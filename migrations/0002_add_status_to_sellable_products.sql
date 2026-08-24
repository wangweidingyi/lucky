-- Migration number: 0002
ALTER TABLE lucky_sellable_products
ADD COLUMN status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'pending', 'done'));

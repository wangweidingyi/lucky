-- Migration number: 0009
ALTER TABLE miniprogram_coffee_cards
ADD COLUMN coupon_type INTEGER NOT NULL DEFAULT 0;

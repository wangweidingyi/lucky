-- Migration number: 0005
ALTER TABLE lucky_order_users ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'token' CHECK (auth_mode IN ('token', 'miniprogram'));
ALTER TABLE lucky_order_users ADD COLUMN uid TEXT;
ALTER TABLE lucky_order_users ADD COLUMN openid TEXT;
ALTER TABLE lucky_order_users ADD COLUMN black_box TEXT;
ALTER TABLE lucky_order_users ADD COLUMN notify_code TEXT;
ALTER TABLE lucky_order_users ADD COLUMN csid TEXT;
ALTER TABLE lucky_order_users ADD COLUMN pay_type TEXT;
ALTER TABLE lucky_order_users ADD COLUMN miniprogram_version TEXT;
ALTER TABLE lucky_order_users ADD COLUMN aes_key TEXT;
ALTER TABLE lucky_order_users ADD COLUMN base_url TEXT;
ALTER TABLE lucky_order_users ADD COLUMN cookie TEXT;

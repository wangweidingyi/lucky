# Default Pic URL Product Image Design

## Goal

When Luckin product sync payloads contain `defaultPicUrl` but no `pictureUrl`, store that value in `lucky_products.picture_url` so catalog responses expose it as `pictureUrl` for image display.

## Architecture

`lucky_products` already has `picture_url`, and `deserializeLuckinProduct` maps it to the public `pictureUrl` field. New product ingestion should normalize `defaultPicUrl` into `pictureUrl` before upsert, while list/read responses should fall back to `raw.defaultPicUrl` for historical rows that were already stored with `picture_url = NULL`.

## Data Flow

The image URL should be resolved during upsert with this precedence:

1. `pictureUrl`
2. `defaultPicUrl`
3. `picUrl`
4. `null`

The original raw product payload remains stored unchanged in `raw`.

## Testing

Add a regression test in `tests/integration/luckyOrdering.test.ts` that upserts a product with only `defaultPicUrl`, lists products through `listLuckinProducts`, and asserts that the returned row has `pictureUrl` set to the default image URL.

Add coffee-card sync tests that mirror the management UI path: preview products from `/lkadmin/coffee-cards/preview-products`, confirm selected ids through `/lkadmin/coffee-cards/sync-products`, and verify both the API response and persisted `picture_url`.

Add a migration to backfill existing rows from `raw.defaultPicUrl` when `picture_url` is null or blank.

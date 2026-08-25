# Default Pic URL Product Image Design

## Goal

When Luckin product sync payloads contain `defaultPicUrl` but no `pictureUrl`, store that value in `lucky_products.picture_url` so catalog responses expose it as `pictureUrl` for image display.

## Architecture

`lucky_products` already has `picture_url`, and `deserializeLuckinProduct` already maps it to the public `pictureUrl` field. The change belongs in the shared `upsertLuckinProducts` input path so every product ingestion flow gets the same image fallback behavior.

## Data Flow

The image URL should be resolved during upsert with this precedence:

1. `pictureUrl`
2. `defaultPicUrl`
3. `picUrl`
4. `null`

The original raw product payload remains stored unchanged in `raw`.

## Testing

Add a regression test in `tests/integration/luckyOrdering.test.ts` that upserts a product with only `defaultPicUrl`, lists products through `listLuckinProducts`, and asserts that the returned row has `pictureUrl` set to the default image URL.

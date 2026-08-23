# Luckin Product Catalog Design

## Problem

The order claiming flow currently depends on `lucky_sellable_products.sellable_product_ids` and `sellable_sku_codes` as if they were real Luckin catalog data. Some rows still contain test values, so product detail and preview calls fail before the user can make a real selection.

## Recommended Approach

Add a local Luckin product catalog table and make the claim flow select from that catalog before querying Luckin product details. The existing sellable product table remains the business order record, while the new catalog table stores real Luckin products discovered through `searchProductForMcp`.

## Backend Architecture

- Create `lucky_products` with real Luckin identifiers and display data:
  - `product_id`
  - `sku_code`
  - `product_name`
  - `picture_url`
  - `initial_price`
  - `estimate_price`
  - `tags`
  - `attrs`
  - `raw`
  - `source_query`
  - `last_synced_at`
  - soft-delete flag
- Upsert by `(product_id, sku_code)` so repeated searches refresh existing records.
- Add catalog endpoints under `/order/catalog/*`, all gated by `id` and `sign`.
- Resolve the Luckin user token through the existing sellable product id. No token is exposed to the frontend.
- Do not make automatic live Luckin requests during page load. Live `searchProductForMcp` calls happen only when the user triggers sync for a selected shop.

## Frontend Architecture

Replace the long single-scroll flow with a single active step:

1. Select shop.
2. Select product from local catalog.
3. Load selected product detail with `queryProductDetailInfo`.
4. Preview order with `previewOrder`.
5. Create order with `createOrder`.

If the catalog is empty, the product step offers an explicit sync action for default queries `["美式", "拿铁"]` after a shop has been selected.

## Data Correction

Add a repair endpoint that can update the current sellable product row with randomly selected real catalog products. This keeps current downstream APIs compatible because `sellable_product_ids` and `sellable_sku_codes` become real Luckin identifiers.

## Safety

- Tests mock Luckin MCP responses and never call the real network.
- The UI only syncs catalog data after the user has selected a shop and explicitly clicks sync.
- Order creation still happens only on the final confirmation step.


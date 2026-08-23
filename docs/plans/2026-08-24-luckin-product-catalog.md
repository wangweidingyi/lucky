# Luckin Product Catalog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store real Luckin product catalog data, sync it through the real user token only on explicit request, and repair sellable product rows with real product ids and sku codes.

**Architecture:** Add a D1-backed catalog model and `/order/catalog/*` routes. Catalog sync uses the existing id-gated Luckin MCP forwarder with `searchProductForMcp`, upserts returned products, and exposes local list data to the frontend.

**Tech Stack:** Cloudflare Workers, Hono, Chanfana, D1, Zod, Vitest.

---

### Task 1: Catalog Model And Migration

**Files:**
- Create: `migrations/0004_create_lucky_products.sql`
- Create: `src/models/luckyProducts.ts`
- Test: `tests/integration/luckyOrdering.test.ts`

**Step 1: Write the failing test**

Add a test that inserts two product-like records through the model, upserts one existing product, and verifies list returns one row per `(product_id, sku_code)` with JSON fields deserialized.

**Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand`

Expected: failure because `src/models/luckyProducts.ts` does not exist.

**Step 3: Write minimal implementation**

Create the migration and model:
- `lucky_products` table with unique `(product_id, sku_code)`.
- `upsertLuckinProducts(db, products, sourceQuery)`.
- `listLuckinProducts(db)`.
- JSON serialization for `tags`, `attrs`, and `raw`.

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: catalog model test passes with the rest of the suite.

### Task 2: Catalog List Endpoint

**Files:**
- Create: `src/controller/order/catalog.ts`
- Modify: `src/controller/order/order.ts`
- Test: `tests/integration/luckyOrdering.test.ts`

**Step 1: Write the failing test**

Add a POST `/order/catalog/list` test that:
- Creates an order user.
- Creates a sellable product for that user.
- Seeds a catalog product through the model.
- Calls the endpoint with `id/sign`.
- Expects local products returned without calling Luckin MCP.

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: 404 for `/order/catalog/list`.

**Step 3: Write minimal implementation**

Add a Chanfana route using `sellableProductIdBodySchema`, verify the sellable product exists, and return `listLuckinProducts`.

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: new endpoint test passes.

### Task 3: Catalog Sync Endpoint

**Files:**
- Modify: `src/controller/order/catalog.ts`
- Test: `tests/integration/luckyOrdering.test.ts`

**Step 1: Write the failing test**

Add a pure function test for syncing products with a mocked fetcher:
- Input includes `id`, `sign`, `deptId`, and queries `["美式", "拿铁"]`.
- Mock Luckin MCP returns product lists for each query.
- Expect `searchProductForMcp` called once per query with the user's token.
- Expect returned products persisted and listed.

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: missing sync function or endpoint failure.

**Step 3: Write minimal implementation**

Add:
- `syncLuckinCatalogForSellableProduct(db, fetcher, input)`.
- `POST /order/catalog/sync`.
- Default queries `["美式", "拿铁"]`.
- Product response parsing tolerant of extra Luckin fields.

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: sync test passes and no real network is called.

### Task 4: Sellable Product Repair Endpoint

**Files:**
- Modify: `src/models/luckySellableProducts.ts`
- Modify: `src/controller/order/catalog.ts`
- Test: `tests/integration/luckyOrdering.test.ts`

**Step 1: Write the failing test**

Add a POST `/order/catalog/repairSellable` test that:
- Creates a sellable product with test ids.
- Seeds real catalog products.
- Calls repair with `id/sign`.
- Expects the sellable product row updated to real `product_id` and `sku_code` values.

**Step 2: Run test to verify it fails**

Run: `npm test`

Expected: 404 or unchanged sellable product.

**Step 3: Write minimal implementation**

Add `replaceSellableProductCatalogRefs(db, id, products)` and a route that uses local catalog rows to update the current sellable row. Keep quantity unchanged.

**Step 4: Run test to verify it passes**

Run: `npm test`

Expected: repair test passes.

### Task 5: Final Backend Verification

**Files:**
- All backend files above.

**Step 1: Run formatting/type/build-equivalent verification**

Run: `npm test`

Expected: dry-run deploy passes and Vitest reports all tests passing.

**Step 2: Review diff**

Run: `git diff --stat && git diff`

Expected: only catalog, route, migration, tests, and docs changes are present.


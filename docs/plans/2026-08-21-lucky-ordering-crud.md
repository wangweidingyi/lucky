# Lucky Ordering CRUD Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Cloudflare template API with POST-only CRUD for Luckin order users and sellable products.

**Architecture:** Use Hono + Chanfana custom OpenAPI routes backed by Cloudflare D1. Generic helper functions will handle id generation, validation, inserts, updates, reads, list queries, and soft deletes so the two resources stay consistent without relying on Chanfana's path-param CRUD endpoints.

**Tech Stack:** TypeScript, Hono, Chanfana, Zod, Cloudflare Workers, D1, Vitest.

---

### Task 1: Write Failing Order User Integration Tests

**Files:**

- Modify: `tests/integration/tasks.test.ts`
- Delete later: `tests/integration/dummyEndpoint.test.ts`

**Step 1: Replace task tests with order user CRUD tests**

Cover:

- `POST /order-users/create` creates a row with a generated 10-character id.
- Create defaults `type` to `lucky`, `status` to `enabled`, and `is_delete` to `0`.
- `POST /order-users/list` returns active rows.
- `POST /order-users/read` reads by body `{ id }`.
- `POST /order-users/update` updates by body `{ id, ...fields }`.
- `POST /order-users/delete` soft deletes by body `{ id }`.
- Deleted rows disappear from list/read.

**Step 2: Run tests to verify RED**

Run:

```bash
npm test -- tests/integration/tasks.test.ts
```

Expected: FAIL because `/order-users/*` routes do not exist yet.

### Task 2: Write Failing Sellable Product Integration Tests

**Files:**

- Create: `tests/integration/luckyOrdering.test.ts` or continue using `tests/integration/tasks.test.ts`

**Step 1: Add sellable product CRUD tests**

Cover:

- Creating an order user first.
- `POST /sellable-products/create` accepts `sellable_product_ids` and `sellable_sku_codes` arrays.
- `sellable_quantity` defaults to `1`.
- `third_party_remark_id` accepts exactly three alphanumeric characters.
- Invalid `third_party_remark_id` returns `400`.
- Missing or unknown `order_user_id` returns a client error.
- List/read/update/delete all use POST bodies.
- Delete is soft delete.

**Step 2: Run tests to verify RED**

Run:

```bash
npm test -- tests/integration/luckyOrdering.test.ts
```

Expected: FAIL because the new routes and tables do not exist yet.

### Task 3: Replace D1 Migration

**Files:**

- Modify: `migrations/0001_add_tasks_table.sql`

**Step 1: Replace template schema**

Create:

- `lucky_order_users`
- `lucky_sellable_products`

Use TEXT primary keys for 10-character ids and a foreign key from `lucky_sellable_products.order_user_id` to `lucky_order_users.id`.

**Step 2: Run tests**

Run:

```bash
npm test -- tests/integration/luckyOrdering.test.ts
```

Expected: Still FAIL because routes are not implemented.

### Task 4: Add Shared CRUD Helpers

**Files:**

- Create: `src/endpoints/shared/id.ts`
- Create: `src/endpoints/shared/responses.ts`
- Create: `src/endpoints/shared/d1.ts`

**Step 1: Add id generator**

Implement a 10-character id generator using nanoid and the alphabet `abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`.

**Step 2: Add response helpers**

Implement `ok(result, status?)` and `fail(message, status?)` helpers matching the existing response shape.

**Step 3: Add D1 helpers only as needed**

Keep helpers small. Do not create a framework; add only code needed by the two resources.

**Step 4: Run tests**

Expected: Still FAIL until routes use the helpers.

### Task 5: Implement Order User POST CRUD

**Files:**

- Create: `src/endpoints/orderUsers/base.ts`
- Create: `src/endpoints/orderUsers/router.ts`
- Create: `src/endpoints/orderUsers/orderUserCreate.ts`
- Create: `src/endpoints/orderUsers/orderUserList.ts`
- Create: `src/endpoints/orderUsers/orderUserRead.ts`
- Create: `src/endpoints/orderUsers/orderUserUpdate.ts`
- Create: `src/endpoints/orderUsers/orderUserDelete.ts`
- Modify: `src/index.ts`

**Step 1: Add Zod schemas**

Create schemas for row shape and each POST body.

**Step 2: Implement create**

Generate `id`, apply defaults, insert into D1, return inserted row.

**Step 3: Implement list/read/update/delete**

Every endpoint reads JSON body through Chanfana validation. Delete updates `is_delete` to `1`.

**Step 4: Register `/order-users` router**

Mount POST-only operation routes.

**Step 5: Run order user tests**

Expected: PASS for order user tests.

### Task 6: Implement Sellable Product POST CRUD

**Files:**

- Create: `src/endpoints/sellableProducts/base.ts`
- Create: `src/endpoints/sellableProducts/router.ts`
- Create: `src/endpoints/sellableProducts/sellableProductCreate.ts`
- Create: `src/endpoints/sellableProducts/sellableProductList.ts`
- Create: `src/endpoints/sellableProducts/sellableProductRead.ts`
- Create: `src/endpoints/sellableProducts/sellableProductUpdate.ts`
- Create: `src/endpoints/sellableProducts/sellableProductDelete.ts`
- Modify: `src/index.ts`

**Step 1: Add Zod schemas**

Arrays are API arrays and D1 JSON strings. `third_party_remark_id` must match `^[a-zA-Z0-9]{3}$` when present.

**Step 2: Implement create**

Validate `order_user_id` exists and is active. Generate `id`, serialize arrays, apply defaults, insert, and return deserialized row.

**Step 3: Implement list/read/update/delete**

Use POST bodies. Update serializes arrays only when provided. Delete soft deletes.

**Step 4: Register `/sellable-products` router**

Mount POST-only operation routes.

**Step 5: Run sellable product tests**

Expected: PASS for sellable product tests.

### Task 7: Remove Template Routes, Tests, and Docs

**Files:**

- Delete: `src/endpoints/tasks/base.ts`
- Delete: `src/endpoints/tasks/router.ts`
- Delete: `src/endpoints/tasks/taskCreate.ts`
- Delete: `src/endpoints/tasks/taskList.ts`
- Delete: `src/endpoints/tasks/taskRead.ts`
- Delete: `src/endpoints/tasks/taskUpdate.ts`
- Delete: `src/endpoints/tasks/taskDelete.ts`
- Delete: `src/endpoints/dummyEndpoint.ts`
- Delete: `tests/integration/dummyEndpoint.test.ts`
- Modify: `README.md`
- Modify: `package.json`

**Step 1: Remove template imports and routes**

Ensure `src/index.ts` only registers the new routers.

**Step 2: Update metadata/docs**

Rename template description to Luckin proxy ordering API and remove template examples.

**Step 3: Run search**

Run:

```bash
rg "tasks|dummy|Dummy|Task" src tests migrations README.md package.json
```

Expected: No template route/model references remain.

### Task 8: Full Verification

**Files:**

- All touched files.

**Step 1: Typecheck/test**

Run:

```bash
npm test
```

Expected: dry-run deploy succeeds and all Vitest tests pass.

**Step 2: Review git diff**

Run:

```bash
git diff --stat
git diff
```

Expected: Diff only contains template removal and Lucky ordering CRUD.

# Mini-Program Coffee Card Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a new mini-program-only coffee-card ordering flow without changing legacy `/order/*` behavior.

**Architecture:** Keep legacy routes and legacy tables as references, create new `miniprogram_*` tables, and implement new `/miniprogramorder/*` endpoints backed by a dedicated mini-program client. Admin sync creates sellable rows directly from coffee-card remaining quantity; frontend product selection is runtime by selected shop.

**Tech Stack:** Cloudflare Workers, Hono, Chanfana, D1, Zod, CryptoJS, Vitest, React Router, React, Tailwind, Axios/fetch.

---

### Task 1: Backend Tests

**Files:**
- Modify: `tests/integration/luckinCouponSync.test.ts`
- Create: `tests/integration/miniprogramOrder.test.ts`

**Steps:**
1. Add a test proving coffee-card list sync creates one `lucky_sellable_products` row per remaining use with `coffee_card_id`.
2. Add a test proving sync does not write `lucky_products`.
3. Add tests for `/miniprogramorder/card-products` and `/miniprogramorder/create` using encrypted mini-program responses.
4. Run targeted tests and confirm they fail for missing behavior.

### Task 2: Database And Models

**Files:**
- Create: `migrations/0008_create_miniprogram_ordering_tables.sql`
- Modify: `src/models/luckySellableProducts.ts`
- Modify: `src/models/luckyCoffeeCards.ts`

**Steps:**
1. Create `miniprogram_order_users`, `miniprogram_coffee_cards`, and `miniprogram_sellable_products`.
2. Add new models for those tables only.
3. Add helper queries for sellable+coffee-card lookup and card sellable reconciliation.
4. Run targeted tests.

### Task 3: Mini-Program Client And Routes

**Files:**
- Create: `src/controller/miniprogramorder/miniprogramClient.ts`
- Modify: `src/controller/miniprogramorder/miniprogramorder.ts`
- Create: `src/controller/lkadmin/miniprogramAdmin.ts`

**Steps:**
1. Move mini-program signing/encryption/header behavior into a new client for new code.
2. Implement `detail`, `shops/query`, `card-products`, `create`, and optional `order-detail`.
3. Add `/lkadmin/miniprogram/*` admin endpoints for accounts, cards, and sellables.
4. Run backend tests.

### Task 4: Admin UI

**Files:**
- Modify: `/Users/cxc/Documents/maergold/lkorder-admin/app/routes/coffee-card-sync.tsx`
- Modify: `/Users/cxc/Documents/maergold/lkorder-admin/app/types/admin.ts`
- Modify: `/Users/cxc/Documents/maergold/lkorder-admin/app/fetchs/index.ts`

**Steps:**
1. Remove product preview/selection controls from coffee-card sync page.
2. Show card remaining quantity and generated sellable count.
3. Stop calling sync-products/preview-products.
4. Run frontend tests/typecheck.

### Task 5: New Frontend Order UI

**Files:**
- Create: `/Users/cxc/Documents/maergold/lkorder-admin/app/services/miniprogram-order-api.ts`
- Create: `/Users/cxc/Documents/maergold/lkorder-admin/app/types/miniprogram-order.ts`
- Create: `/Users/cxc/Documents/maergold/lkorder-admin/app/routes/miniprogram-order.tsx`
- Modify: `/Users/cxc/Documents/maergold/lkorder-admin/app/routes.ts`

**Steps:**
1. Create typed API service for `/miniprogramorder/*`.
2. Build new page: detail, geolocation/shop search, runtime card-products, submit order.
3. Keep old `claim` components/pages untouched.
4. Run frontend tests/typecheck.

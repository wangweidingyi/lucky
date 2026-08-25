# Lkadmin Management Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a temporary-token protected management API and replace the admin frontend with table CRUD screens.

**Architecture:** Backend management routes live under `/lkadmin` and use a fixed bearer token until real admin accounts are added. Frontend keeps one React Router entry and stores the accepted token in `localStorage`, then calls `/api/lkadmin/*` through the existing Vite proxy.

**Tech Stack:** TypeScript, Hono, Chanfana, Zod, Cloudflare D1, Vitest, React Router, Vite, Tailwind CSS.

---

### Task 1: Backend Admin API Tests

**Files:**
- Create: `tests/integration/lkadmin.test.ts`

**Steps:**
- Write tests for rejected unauthenticated requests.
- Write tests for `/lkadmin/login`.
- Write CRUD tests for `lucky_order_users`.
- Write CRUD tests for `lucky_sellable_products`.
- Write CRUD tests for `lucky_products`.
- Run `npx vitest run --config tests/vitest.config.mts tests/integration/lkadmin.test.ts` and verify the tests fail because the API is missing.

### Task 2: Backend Admin API

**Files:**
- Modify: `src/controller/lkadmin/lkadmin.ts`
- Modify: `src/index.ts`

**Steps:**
- Add a fixed admin token constant.
- Add auth middleware for all routes except `/login`.
- Add reusable JSON parsing, validation, and response helpers.
- Implement POST-only CRUD for `order-users`, `sellable-products`, and `products`.
- Mount `lkadminRouter` at `/lkadmin`.
- Run the lkadmin tests and fix until green.

### Task 3: Frontend API Client

**Files:**
- Add: `app/types/admin.ts`
- Add: `app/services/admin-api.ts`

**Steps:**
- Add shared admin row types for the three tables.
- Add an API error class.
- Add `loginAdmin`, `listRows`, `createRow`, `updateRow`, `deleteRow`, and `readRow` helpers.
- Include `Authorization: Bearer <token>` on protected calls.

### Task 4: Frontend Admin Route

**Files:**
- Modify: `app/routes.ts`
- Replace: `app/routes/home.tsx`

**Steps:**
- Keep only the index route.
- Replace the old claim/order page with an admin login and CRUD dashboard.
- Add table tabs, loading and error states, create/edit forms, and delete actions.
- Use compact table layouts for desktop and readable stacked rows on mobile.

### Task 5: Verification

**Commands:**
- Backend: `npx vitest run --config tests/vitest.config.mts tests/integration/lkadmin.test.ts`
- Backend type/build check: `npm test`
- Frontend: `npm test`
- Frontend typecheck/build: `npm run typecheck`
- Frontend build: `npm run build`

**Expected:** Backend tests pass, frontend tests pass, typecheck succeeds, and the admin app builds.

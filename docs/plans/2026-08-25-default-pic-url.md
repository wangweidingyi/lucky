# Default Pic URL Product Image Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Store Luckin `defaultPicUrl` values in `lucky_products.picture_url` so synced products can display images.

**Architecture:** Extend the shared Luckin product input model to accept `defaultPicUrl` and `picUrl`, then resolve the stored `picture_url` through one small helper. This keeps catalog sync, coffee-card product sync, and future shared upsert callers consistent without a database migration.

**Tech Stack:** TypeScript, Zod, Cloudflare D1, Vitest with Cloudflare Workers pool.

---

### Task 1: Add Regression Test

**Files:**
- Modify: `tests/integration/luckyOrdering.test.ts`

**Step 1: Write the failing test**

Add a test under `describe("Luckin product catalog", ...)`:

```ts
it("uses defaultPicUrl as pictureUrl when syncing Luckin products", async () => {
	await upsertLuckinProducts(
		env.DB,
		[
			{
				productId: 44112,
				productName: "橙C美式",
				skuCode: "SP44112-00001",
				defaultPicUrl: "https://img.example/orange-americano.png",
			},
		],
		"美式",
	);

	await expect(listLuckinProducts(env.DB)).resolves.toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				productId: 44112,
				skuCode: "SP44112-00001",
				pictureUrl: "https://img.example/orange-americano.png",
			}),
		]),
	);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run --config tests/vitest.config.mts tests/integration/luckyOrdering.test.ts --testNamePattern "uses defaultPicUrl"`

Expected: FAIL because `pictureUrl` is currently `null`.

### Task 2: Implement Image URL Fallback

**Files:**
- Modify: `src/models/luckyProducts.ts`
- Test: `tests/integration/luckyOrdering.test.ts`

**Step 1: Extend the input schema**

Add optional nullable string fields for `defaultPicUrl` and `picUrl` to `luckinProductInputSchema`.

**Step 2: Add a resolver helper**

Add:

```ts
function resolveProductPictureUrl(product: LuckinProductInput) {
	return product.pictureUrl ?? product.defaultPicUrl ?? product.picUrl ?? null;
}
```

**Step 3: Store the resolved URL**

Change the `picture_url` bind value in `upsertLuckinProducts` from `product.pictureUrl ?? null` to `resolveProductPictureUrl(product)`.

**Step 4: Run targeted test**

Run: `npx vitest run --config tests/vitest.config.mts tests/integration/luckyOrdering.test.ts --testNamePattern "uses defaultPicUrl"`

Expected: PASS.

### Task 3: Verify Catalog Tests

**Files:**
- Test: `tests/integration/luckyOrdering.test.ts`

**Step 1: Run the integration file**

Run: `npx vitest run --config tests/vitest.config.mts tests/integration/luckyOrdering.test.ts`

Expected: PASS.

**Step 2: Run type check**

Run: `npx tsc --noEmit`

Expected: PASS.

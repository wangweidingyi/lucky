import { fromHono } from "chanfana";
import { Hono } from "hono";
import { z } from "zod";
import { generateId } from "../../shared/id";
import { fail, ok } from "../../shared/responses";
import type { AppContext } from "../../types";
import {
	deserializeLuckinProduct,
	luckinProductRowSchema,
} from "../../models/luckyProducts";
import {
	deserializeSellableProduct,
	sellableProductCreateBodySchema,
	sellableProductRowSchema,
	sellableProductStatusSchema,
	serializeArray,
} from "../../models/luckySellableProducts";
import {
	findActiveOrderUser,
	idSchema,
	orderUserCreateBodySchema,
	orderUserRowSchema,
	orderUserUpdateBodySchema,
} from "../../models/LuckyOrderUsers";
import {
	deserializeCoffeeCard,
	listCoffeeCards,
} from "../../models/luckyCoffeeCards";
import {
	CoffeeCardSyncError,
	previewCoffeeCardProductsBodySchema,
	previewLuckinCoffeeCardProducts,
	syncCoffeeCardProductsBodySchema,
	syncCoffeeCardsBodySchema,
	syncLuckinCoffeeCardProducts,
	syncLuckinCoffeeCards,
} from "./couponSync";

const adminToken = "lkadmin-dev-token";

export const lkadminRouter = fromHono(new Hono());

const loginBodySchema = z.object({
	token: z.string().min(1),
});

const orderUserIdBodySchema = z.object({
	id: idSchema,
});

const adminSellableProductUpdateBodySchema = orderUserIdBodySchema.extend({
	sellable_product_ids: z.array(z.string()).min(1).optional(),
	sellable_sku_codes: z.array(z.string()).min(1).optional(),
	sellable_quantity: z.number().int().positive().optional(),
	status: sellableProductStatusSchema.optional(),
	order_user_id: idSchema.optional(),
	third_party_remark_id: z
		.string()
		.regex(/^[a-zA-Z0-9]{3}$/)
		.optional()
		.nullable(),
	third_party_order_id: z.string().optional().nullable(),
	third_party_product_id: z.string().optional().nullable(),
});

const productIdBodySchema = z.object({
	id: z.number().int().positive(),
});

const coffeeCardIdBodySchema = z.object({
	id: z.number().int().positive(),
});

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(jsonValueSchema),
	]),
);
const productAttrSchema = z.record(jsonValueSchema);

const adminProductCreateBodySchema = z.object({
	productId: z.number().int().positive(),
	productName: z.string().min(1),
	skuCode: z.string().min(1),
	pictureUrl: z.string().optional().nullable(),
	initialPrice: z.number().optional().nullable(),
	estimatePrice: z.number().optional().nullable(),
	tags: z.array(z.string()).optional().default([]),
	attrs: z.array(productAttrSchema).optional().default([]),
	raw: z.record(jsonValueSchema).optional().default({}),
	sourceQuery: z.string().optional().nullable(),
});

const adminProductUpdateBodySchema = productIdBodySchema.extend({
	productId: z.number().int().positive().optional(),
	productName: z.string().min(1).optional(),
	skuCode: z.string().min(1).optional(),
	pictureUrl: z.string().optional().nullable(),
	initialPrice: z.number().optional().nullable(),
	estimatePrice: z.number().optional().nullable(),
	tags: z.array(z.string()).optional(),
	attrs: z.array(productAttrSchema).optional(),
	raw: z.record(jsonValueSchema).optional(),
	sourceQuery: z.string().optional().nullable(),
});

const adminCoffeeCardCreateBodySchema = z.object({
	orderUserId: idSchema,
	cafeKuId: z.string().min(1),
	couponNo: z.string().optional().nullable(),
	coffeeVoucherType: z.number().int().optional().default(0),
	cardName: z.string().optional().nullable(),
	usableQuantity: z.number().int().nonnegative().optional().default(1),
	syncedProductCount: z.number().int().nonnegative().optional().default(0),
	generatedSellableCount: z.number().int().nonnegative().optional().default(0),
	raw: z.record(jsonValueSchema).optional().default({}),
});

const adminCoffeeCardUpdateBodySchema = coffeeCardIdBodySchema.extend({
	orderUserId: idSchema.optional(),
	cafeKuId: z.string().min(1).optional(),
	couponNo: z.string().optional().nullable(),
	coffeeVoucherType: z.number().int().optional(),
	cardName: z.string().optional().nullable(),
	usableQuantity: z.number().int().nonnegative().optional(),
	syncedProductCount: z.number().int().nonnegative().optional(),
	generatedSellableCount: z.number().int().nonnegative().optional(),
	raw: z.record(jsonValueSchema).optional(),
});

type ProductDbRow = Parameters<typeof deserializeLuckinProduct>[0];
type CoffeeCardDbRow = Parameters<typeof deserializeCoffeeCard>[0];

function validationError(c: AppContext, error: z.ZodError) {
	return c.json(
		{
			code: 400,
			errors: error.issues.map((issue) => ({
				code: 400,
				message: issue.path.length
					? `${issue.path.join(".")}: ${issue.message}`
					: issue.message,
			})),
		},
		400,
	);
}

async function readJson(c: AppContext) {
	try {
		return await c.req.json();
	} catch {
		return undefined;
	}
}

async function parseBody<T extends z.ZodTypeAny>(
	c: AppContext,
	schema: T,
): Promise<z.infer<T> | Response> {
	const body = await readJson(c);
	const parsed = schema.safeParse(body ?? {});

	if (!parsed.success) {
		return validationError(c, parsed.error);
	}

	return parsed.data;
}

function isResponse(value: unknown): value is Response {
	return value instanceof Response;
}

function setClauseFromBody(
	body: Record<string, unknown>,
	columns: Record<string, string | ((value: unknown) => unknown)>,
	exclude = new Set(["id"]),
) {
	const assignments: string[] = [];
	const values: unknown[] = [];

	for (const [key, value] of Object.entries(body)) {
		if (exclude.has(key) || value === undefined || !(key in columns)) {
			continue;
		}

		const column = columns[key];
		assignments.push(`${typeof column === "string" ? column : key} = ?`);
		values.push(typeof column === "function" ? column(value) : value);
	}

	return { assignments, values };
}

async function getOrderUser(db: D1Database, id: string, includeDeleted = false) {
	const row = await db
		.prepare(
			`SELECT *
			 FROM lucky_order_users
			 WHERE id = ? ${includeDeleted ? "" : "AND is_delete = 0"}`,
		)
		.bind(id)
		.first<z.infer<typeof orderUserRowSchema>>();

	return row ?? null;
}

async function getSellableProduct(
	db: D1Database,
	id: string,
	includeDeleted = false,
) {
	const row = await db
		.prepare(
			`SELECT *
			 FROM lucky_sellable_products
			 WHERE id = ? ${includeDeleted ? "" : "AND is_delete = 0"}`,
		)
		.bind(id)
		.first<Parameters<typeof deserializeSellableProduct>[0]>();

	return row ? deserializeSellableProduct(row) : null;
}

async function getProduct(db: D1Database, id: number, includeDeleted = false) {
	const row = await db
		.prepare(
			`SELECT *
			 FROM lucky_products
			 WHERE id = ? ${includeDeleted ? "" : "AND is_delete = 0"}`,
		)
		.bind(id)
		.first<ProductDbRow>();

	return row ? deserializeLuckinProduct(row) : null;
}

async function getCoffeeCard(
	db: D1Database,
	id: number,
	includeDeleted = false,
) {
	const row = await db
		.prepare(
			`SELECT *
			 FROM lucky_coffee_cards
			 WHERE id = ? ${includeDeleted ? "" : "AND is_delete = 0"}`,
		)
		.bind(id)
		.first<CoffeeCardDbRow>();

	return row ? deserializeCoffeeCard(row) : null;
}

lkadminRouter.post("/login", async (c: AppContext) => {
	const body = await parseBody(c, loginBodySchema);
	if (isResponse(body)) {
		return body;
	}

	if (body.token !== adminToken) {
		return fail(c, "Unauthorized", 401);
	}

	return ok(c, { token: adminToken });
});

lkadminRouter.use("*", async (c: AppContext, next) => {
	if (c.req.path.endsWith("/login")) {
		return next();
	}

	const authorization = c.req.header("Authorization") ?? "";
	if (authorization !== `Bearer ${adminToken}`) {
		return fail(c, "Unauthorized", 401);
	}

	return next();
});

lkadminRouter.post("/order-users/list", async (c: AppContext) => {
	const result = await c.env.DB.prepare(
		`SELECT *
		 FROM lucky_order_users
		 WHERE is_delete = 0
		 ORDER BY nickname ASC, id ASC`,
	).all<z.infer<typeof orderUserRowSchema>>();

	return ok(c, result.results);
});

lkadminRouter.post("/order-users/create", async (c: AppContext) => {
	const body = await parseBody(c, orderUserCreateBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const id = generateId();
	await c.env.DB.prepare(
		`INSERT INTO lucky_order_users (
			id,
			nickname,
			token,
			type,
			status,
			auth_mode,
			uid,
			openid,
			black_box,
			notify_code,
			csid,
			pay_type,
			miniprogram_version,
			aes_key,
			base_url,
			cookie,
			is_delete
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
	)
		.bind(
			id,
			body.nickname,
			body.token,
			body.type,
			body.status,
			body.auth_mode,
			body.uid,
			body.openid,
			body.black_box,
			body.notify_code,
			body.csid,
			body.pay_type,
			body.miniprogram_version,
			body.aes_key,
			body.base_url,
			body.cookie,
		)
		.run();

	return ok(c, await getOrderUser(c.env.DB, id), 201);
});

lkadminRouter.post("/order-users/read", async (c: AppContext) => {
	const body = await parseBody(c, orderUserIdBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const row = await getOrderUser(c.env.DB, body.id);
	return row ? ok(c, row) : fail(c, "Not Found", 404);
});

lkadminRouter.post("/order-users/update", async (c: AppContext) => {
	const body = await parseBody(c, orderUserUpdateBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const existing = await findActiveOrderUser(c.env.DB, body.id);
	if (!existing) {
		return fail(c, "Not Found", 404);
	}

	const { assignments, values } = setClauseFromBody(body, {
		nickname: "nickname",
		token: "token",
		type: "type",
		status: "status",
		auth_mode: "auth_mode",
		uid: "uid",
		openid: "openid",
		black_box: "black_box",
		notify_code: "notify_code",
		csid: "csid",
		pay_type: "pay_type",
		miniprogram_version: "miniprogram_version",
		aes_key: "aes_key",
		base_url: "base_url",
		cookie: "cookie",
	});

	if (assignments.length > 0) {
		await c.env.DB.prepare(
			`UPDATE lucky_order_users
			 SET ${assignments.join(", ")}
			 WHERE id = ? AND is_delete = 0`,
		)
			.bind(...values, body.id)
			.run();
	}

	return ok(c, await getOrderUser(c.env.DB, body.id));
});

lkadminRouter.post("/order-users/delete", async (c: AppContext) => {
	const body = await parseBody(c, orderUserIdBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const existing = await findActiveOrderUser(c.env.DB, body.id);
	if (!existing) {
		return fail(c, "Not Found", 404);
	}

	await c.env.DB.prepare(
		"UPDATE lucky_order_users SET is_delete = 1 WHERE id = ? AND is_delete = 0",
	)
		.bind(body.id)
		.run();

	return ok(c, await getOrderUser(c.env.DB, body.id, true));
});

lkadminRouter.post("/sellable-products/list", async (c: AppContext) => {
	const result = await c.env.DB.prepare(
		`SELECT *
		 FROM lucky_sellable_products
		 WHERE is_delete = 0
		 ORDER BY id ASC`,
	).all<Parameters<typeof deserializeSellableProduct>[0]>();

	return ok(c, result.results.map(deserializeSellableProduct));
});

lkadminRouter.post("/sellable-products/create", async (c: AppContext) => {
	const body = await parseBody(c, sellableProductCreateBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const orderUser = await findActiveOrderUser(c.env.DB, body.order_user_id);
	if (!orderUser) {
		return fail(c, "order_user_id does not reference an active order user", 400);
	}

	const id = generateId();
	await c.env.DB.prepare(
		`INSERT INTO lucky_sellable_products (
			id,
			sellable_product_ids,
			sellable_sku_codes,
			sellable_quantity,
			status,
			order_user_id,
			third_party_remark_id,
			third_party_order_id,
			third_party_product_id,
			is_delete
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
	)
		.bind(
			id,
			serializeArray(body.sellable_product_ids),
			serializeArray(body.sellable_sku_codes),
			body.sellable_quantity,
			body.status,
			body.order_user_id,
			body.third_party_remark_id ?? null,
			body.third_party_order_id ?? null,
			body.third_party_product_id ?? null,
		)
		.run();

	return ok(c, await getSellableProduct(c.env.DB, id), 201);
});

lkadminRouter.post("/sellable-products/read", async (c: AppContext) => {
	const body = await parseBody(c, orderUserIdBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const row = await getSellableProduct(c.env.DB, body.id);
	return row ? ok(c, row) : fail(c, "Not Found", 404);
});

lkadminRouter.post("/sellable-products/update", async (c: AppContext) => {
	const body = await parseBody(c, adminSellableProductUpdateBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const existing = await getSellableProduct(c.env.DB, body.id);
	if (!existing) {
		return fail(c, "Not Found", 404);
	}

	if (body.order_user_id) {
		const orderUser = await findActiveOrderUser(c.env.DB, body.order_user_id);
		if (!orderUser) {
			return fail(c, "order_user_id does not reference an active order user", 400);
		}
	}

	const { assignments, values } = setClauseFromBody(body, {
		sellable_product_ids: (value) => serializeArray(value as string[]),
		sellable_sku_codes: (value) => serializeArray(value as string[]),
		sellable_quantity: "sellable_quantity",
		status: "status",
		order_user_id: "order_user_id",
		third_party_remark_id: "third_party_remark_id",
		third_party_order_id: "third_party_order_id",
		third_party_product_id: "third_party_product_id",
	});

	if (assignments.length > 0) {
		await c.env.DB.prepare(
			`UPDATE lucky_sellable_products
			 SET ${assignments.join(", ")}
			 WHERE id = ? AND is_delete = 0`,
		)
			.bind(...values, body.id)
			.run();
	}

	return ok(c, await getSellableProduct(c.env.DB, body.id));
});

lkadminRouter.post("/sellable-products/delete", async (c: AppContext) => {
	const body = await parseBody(c, orderUserIdBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const existing = await getSellableProduct(c.env.DB, body.id);
	if (!existing) {
		return fail(c, "Not Found", 404);
	}

	await c.env.DB.prepare(
		"UPDATE lucky_sellable_products SET is_delete = 1 WHERE id = ? AND is_delete = 0",
	)
		.bind(body.id)
		.run();

	return ok(c, await getSellableProduct(c.env.DB, body.id, true));
});

lkadminRouter.post("/products/list", async (c: AppContext) => {
	const result = await c.env.DB.prepare(
		`SELECT *
		 FROM lucky_products
		 WHERE is_delete = 0
		 ORDER BY product_name ASC, product_id ASC, sku_code ASC`,
	).all<ProductDbRow>();

	return ok(c, result.results.map(deserializeLuckinProduct));
});

lkadminRouter.post("/products/create", async (c: AppContext) => {
	const body = await parseBody(c, adminProductCreateBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const result = await c.env.DB.prepare(
		`INSERT INTO lucky_products (
			product_id,
			sku_code,
			product_name,
			picture_url,
			initial_price,
			estimate_price,
			tags,
			attrs,
			raw,
			source_query,
			last_synced_at,
			is_delete
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 0)
		ON CONFLICT(product_id, sku_code) DO UPDATE SET
			product_name = excluded.product_name,
			picture_url = excluded.picture_url,
			initial_price = excluded.initial_price,
			estimate_price = excluded.estimate_price,
			tags = excluded.tags,
			attrs = excluded.attrs,
			raw = excluded.raw,
			source_query = excluded.source_query,
			last_synced_at = CURRENT_TIMESTAMP,
			is_delete = 0`,
	)
		.bind(
			body.productId,
			body.skuCode,
			body.productName,
			body.pictureUrl ?? null,
			body.initialPrice ?? null,
			body.estimatePrice ?? null,
			JSON.stringify(body.tags),
			JSON.stringify(body.attrs),
			JSON.stringify(body.raw),
			body.sourceQuery ?? null,
		)
		.run();

	const row =
		result.meta.last_row_id !== undefined
			? await getProduct(c.env.DB, Number(result.meta.last_row_id))
			: await c.env.DB.prepare(
					`SELECT *
					 FROM lucky_products
					 WHERE product_id = ? AND sku_code = ? AND is_delete = 0`,
				)
					.bind(body.productId, body.skuCode)
					.first<ProductDbRow>()
					.then((dbRow) => (dbRow ? deserializeLuckinProduct(dbRow) : null));

	return ok(c, row, 201);
});

lkadminRouter.post("/products/read", async (c: AppContext) => {
	const body = await parseBody(c, productIdBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const row = await getProduct(c.env.DB, body.id);
	return row ? ok(c, row) : fail(c, "Not Found", 404);
});

lkadminRouter.post("/products/update", async (c: AppContext) => {
	const body = await parseBody(c, adminProductUpdateBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const existing = await getProduct(c.env.DB, body.id);
	if (!existing) {
		return fail(c, "Not Found", 404);
	}

	const { assignments, values } = setClauseFromBody(body, {
		productId: "product_id",
		productName: "product_name",
		skuCode: "sku_code",
		pictureUrl: "picture_url",
		initialPrice: "initial_price",
		estimatePrice: "estimate_price",
		tags: (value) => JSON.stringify(value),
		attrs: (value) => JSON.stringify(value),
		raw: (value) => JSON.stringify(value),
		sourceQuery: "source_query",
	});

	if (assignments.length > 0) {
		await c.env.DB.prepare(
			`UPDATE lucky_products
			 SET ${assignments.join(", ")}, last_synced_at = CURRENT_TIMESTAMP
			 WHERE id = ? AND is_delete = 0`,
		)
			.bind(...values, body.id)
			.run();
	}

	return ok(c, await getProduct(c.env.DB, body.id));
});

lkadminRouter.post("/products/delete", async (c: AppContext) => {
	const body = await parseBody(c, productIdBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const existing = await getProduct(c.env.DB, body.id);
	if (!existing) {
		return fail(c, "Not Found", 404);
	}

	await c.env.DB.prepare(
		"UPDATE lucky_products SET is_delete = 1 WHERE id = ? AND is_delete = 0",
	)
		.bind(body.id)
		.run();

	return ok(c, await getProduct(c.env.DB, body.id, true));
});

lkadminRouter.post("/coffee-cards/list", async (c: AppContext) => {
	const body = await parseBody(
		c,
		z.object({ order_user_id: idSchema.optional() }),
	);
	if (isResponse(body)) {
		return body;
	}

	return ok(c, await listCoffeeCards(c.env.DB, body.order_user_id));
});

lkadminRouter.post("/coffee-cards/create", async (c: AppContext) => {
	const body = await parseBody(c, adminCoffeeCardCreateBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const orderUser = await findActiveOrderUser(c.env.DB, body.orderUserId);
	if (!orderUser) {
		return fail(c, "orderUserId does not reference an active order user", 400);
	}

	const result = await c.env.DB.prepare(
		`INSERT INTO lucky_coffee_cards (
			order_user_id,
			cafe_ku_id,
			coupon_no,
			coffee_voucher_type,
			card_name,
			usable_quantity,
			synced_product_count,
			generated_sellable_count,
			last_synced_at,
			raw,
			is_delete
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 0)`,
	)
		.bind(
			body.orderUserId,
			body.cafeKuId,
			body.couponNo ?? null,
			body.coffeeVoucherType,
			body.cardName ?? null,
			body.usableQuantity,
			body.syncedProductCount,
			body.generatedSellableCount,
			JSON.stringify(body.raw),
		)
		.run();

	return ok(c, await getCoffeeCard(c.env.DB, Number(result.meta.last_row_id)), 201);
});

lkadminRouter.post("/coffee-cards/read", async (c: AppContext) => {
	const body = await parseBody(c, coffeeCardIdBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const row = await getCoffeeCard(c.env.DB, body.id);
	return row ? ok(c, row) : fail(c, "Not Found", 404);
});

lkadminRouter.post("/coffee-cards/update", async (c: AppContext) => {
	const body = await parseBody(c, adminCoffeeCardUpdateBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const existing = await getCoffeeCard(c.env.DB, body.id);
	if (!existing) {
		return fail(c, "Not Found", 404);
	}

	if (body.orderUserId) {
		const orderUser = await findActiveOrderUser(c.env.DB, body.orderUserId);
		if (!orderUser) {
			return fail(c, "orderUserId does not reference an active order user", 400);
		}
	}

	const { assignments, values } = setClauseFromBody(body, {
		orderUserId: "order_user_id",
		cafeKuId: "cafe_ku_id",
		couponNo: "coupon_no",
		coffeeVoucherType: "coffee_voucher_type",
		cardName: "card_name",
		usableQuantity: "usable_quantity",
		syncedProductCount: "synced_product_count",
		generatedSellableCount: "generated_sellable_count",
		raw: (value) => JSON.stringify(value),
	});

	if (assignments.length > 0) {
		await c.env.DB.prepare(
			`UPDATE lucky_coffee_cards
			 SET ${assignments.join(", ")}, last_synced_at = CURRENT_TIMESTAMP
			 WHERE id = ? AND is_delete = 0`,
		)
			.bind(...values, body.id)
			.run();
	}

	return ok(c, await getCoffeeCard(c.env.DB, body.id));
});

lkadminRouter.post("/coffee-cards/delete", async (c: AppContext) => {
	const body = await parseBody(c, coffeeCardIdBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const existing = await getCoffeeCard(c.env.DB, body.id);
	if (!existing) {
		return fail(c, "Not Found", 404);
	}

	await c.env.DB.prepare(
		"UPDATE lucky_coffee_cards SET is_delete = 1 WHERE id = ? AND is_delete = 0",
	)
		.bind(body.id)
		.run();

	return ok(c, await getCoffeeCard(c.env.DB, body.id, true));
});

lkadminRouter.post("/coffee-cards/sync", async (c: AppContext) => {
	const body = await parseBody(c, syncCoffeeCardsBodySchema);
	if (isResponse(body)) {
		return body;
	}

	try {
		return ok(c, await syncLuckinCoffeeCards(c.env.DB, fetch, body));
	} catch (error) {
		if (error instanceof CoffeeCardSyncError) {
			return fail(c, error.message, error.status);
		}

		throw error;
	}
});

lkadminRouter.post("/coffee-cards/sync-products", async (c: AppContext) => {
	const body = await parseBody(c, syncCoffeeCardProductsBodySchema);
	if (isResponse(body)) {
		return body;
	}

	try {
		return ok(c, await syncLuckinCoffeeCardProducts(c.env.DB, fetch, body));
	} catch (error) {
		if (error instanceof CoffeeCardSyncError) {
			return fail(c, error.message, error.status);
		}

		throw error;
	}
});

lkadminRouter.post("/coffee-cards/preview-products", async (c: AppContext) => {
	const body = await parseBody(c, previewCoffeeCardProductsBodySchema);
	if (isResponse(body)) {
		return body;
	}

	try {
		return ok(c, await previewLuckinCoffeeCardProducts(c.env.DB, fetch, body));
	} catch (error) {
		if (error instanceof CoffeeCardSyncError) {
			return fail(c, error.message, error.status);
		}

		throw error;
	}
});

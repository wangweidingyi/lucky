import { fromHono } from "chanfana";
import { Hono } from "hono";
import { z } from "zod";
import {
	deserializeMiniprogramCoffeeCard,
	listMiniprogramCoffeeCards,
} from "../../models/miniprogramCoffeeCards";
import {
	miniprogramIdSchema,
	miniprogramOrderUserCreateBodySchema,
	miniprogramOrderUserIdBodySchema,
	miniprogramOrderUserRowSchema,
	miniprogramOrderUserUpdateBodySchema,
} from "../../models/miniprogramOrderUsers";
import {
	deserializeMiniprogramSellable,
	miniprogramSellableIdSchema,
	type MiniprogramSellableRow,
} from "../../models/miniprogramSellableProducts";
import { generateId } from "../../shared/id";
import { fail, ok } from "../../shared/responses";
import type { AppContext } from "../../types";
import { MiniprogramClientError } from "../miniprogramorder/miniprogramClient";
import {
	generateMiniprogramSellablesForCard,
	MiniprogramOrderError,
	syncMiniprogramCoffeeCards,
} from "../miniprogramorder/miniprogramorder";

const adminToken = "lkadmin-dev-token";

const listCoffeeCardsBodySchema = z.object({
	orderUserId: miniprogramIdSchema.optional(),
});

const listSellableBodySchema = z.object({
	orderUserId: miniprogramIdSchema.optional(),
	coffeeCardId: z.number().int().positive().optional(),
	status: z.enum(["waiting", "pending", "done"]).optional(),
});

const router = new Hono<{ Bindings: Env }>();

router.post("/login", async (c: AppContext) => {
	const body = await parseBody(c, z.object({ token: z.string().min(1) }));
	if (isResponse(body)) {
		return body;
	}

	if (body.token !== adminToken) {
		return fail(c, "Unauthorized", 401);
	}

	return ok(c, { token: adminToken });
});

router.use("*", async (c: AppContext, next) => {
	if (c.req.path.endsWith("/login")) {
		return next();
	}

	const authorization = c.req.header("Authorization") ?? "";
	if (authorization !== `Bearer ${adminToken}`) {
		return fail(c, "Unauthorized", 401);
	}

	return next();
});

router.post("/order-users/list", async (c: AppContext) => {
	const result = await c.env.DB.prepare(
		`SELECT *
		 FROM miniprogram_order_users
		 WHERE is_delete = 0
		 ORDER BY nickname ASC, id ASC`,
	).all<z.infer<typeof miniprogramOrderUserRowSchema>>();

	return ok(c, result.results);
});

router.post("/order-users/create", async (c: AppContext) => {
	const body = await parseBody(c, miniprogramOrderUserCreateBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const id = generateId();
	await c.env.DB.prepare(
		`INSERT INTO miniprogram_order_users (
			id,
			nickname,
			status,
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
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
	)
		.bind(
			id,
			body.nickname,
			body.status,
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

router.post("/order-users/read", async (c: AppContext) => {
	const body = await parseBody(c, miniprogramOrderUserIdBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const row = await getOrderUser(c.env.DB, body.id);
	return row ? ok(c, row) : fail(c, "Not Found", 404);
});

router.post("/order-users/update", async (c: AppContext) => {
	const body = await parseBody(c, miniprogramOrderUserUpdateBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const existing = await getOrderUser(c.env.DB, body.id);
	if (!existing) {
		return fail(c, "Not Found", 404);
	}

	const { assignments, values } = setClauseFromBody(body, {
		nickname: "nickname",
		status: "status",
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
			`UPDATE miniprogram_order_users
			 SET ${assignments.join(", ")}
			 WHERE id = ? AND is_delete = 0`,
		)
			.bind(...values, body.id)
			.run();
	}

	return ok(c, await getOrderUser(c.env.DB, body.id));
});

router.post("/order-users/delete", async (c: AppContext) => {
	const body = await parseBody(c, miniprogramOrderUserIdBodySchema);
	if (isResponse(body)) {
		return body;
	}

	await c.env.DB.prepare(
		"UPDATE miniprogram_order_users SET is_delete = 1 WHERE id = ? AND is_delete = 0",
	)
		.bind(body.id)
		.run();

	return ok(c, await getOrderUser(c.env.DB, body.id, true));
});

router.post("/coffee-cards/list", async (c: AppContext) => {
	const body = await parseBody(c, listCoffeeCardsBodySchema);
	if (isResponse(body)) {
		return body;
	}

	return ok(c, await listMiniprogramCoffeeCards(c.env.DB, body.orderUserId));
});

router.post("/coffee-cards/sync", async (c: AppContext) => {
	const body = await parseBody(
		c,
		z.object({ orderUserId: miniprogramIdSchema }),
	);
	if (isResponse(body)) {
		return body;
	}

	try {
		return ok(c, await syncMiniprogramCoffeeCards(c.env.DB, fetch, body));
	} catch (error) {
		return handleMiniprogramError(c, error);
	}
});

router.post("/coffee-cards/generate-sellables", async (c: AppContext) => {
	const body = await parseBody(
		c,
		z.object({
			id: z.number().int().positive(),
			force: z.boolean().optional().default(false),
		}),
	);
	if (isResponse(body)) {
		return body;
	}

	try {
		return ok(c, await generateMiniprogramSellablesForCard(c.env.DB, body));
	} catch (error) {
		return handleMiniprogramError(c, error);
	}
});

router.post("/coffee-cards/delete", async (c: AppContext) => {
	const body = await parseBody(
		c,
		z.object({ id: z.number().int().positive() }),
	);
	if (isResponse(body)) {
		return body;
	}

	const existing = await getCoffeeCard(c.env.DB, body.id);
	if (!existing) {
		return fail(c, "Not Found", 404);
	}

	await c.env.DB.prepare(
		`UPDATE miniprogram_coffee_cards
		 SET is_delete = 1
		 WHERE id = ? AND is_delete = 0`,
	)
		.bind(body.id)
		.run();

	return ok(c, await getCoffeeCard(c.env.DB, body.id, true));
});

router.post("/sellable-products/list", async (c: AppContext) => {
	const body = await parseBody(c, listSellableBodySchema);
	if (isResponse(body)) {
		return body;
	}

	const clauses = ["s.is_delete = 0"];
	const values: unknown[] = [];
	if (body.orderUserId) {
		clauses.push("s.order_user_id = ?");
		values.push(body.orderUserId);
	}
	if (body.coffeeCardId) {
		clauses.push("s.coffee_card_id = ?");
		values.push(body.coffeeCardId);
	}
	if (body.status) {
		clauses.push("s.status = ?");
		values.push(body.status);
	}

	const result = await c.env.DB.prepare(
		`SELECT s.*
		 FROM miniprogram_sellable_products s
		 WHERE ${clauses.join(" AND ")}
		 ORDER BY s.id ASC`,
	)
		.bind(...values)
		.all<Parameters<typeof deserializeMiniprogramSellable>[0]>();

	return ok(c, result.results.map(deserializeMiniprogramSellable));
});

router.post("/sellable-products/delete", async (c: AppContext) => {
	const body = await parseBody(
		c,
		z.object({ id: miniprogramSellableIdSchema }),
	);
	if (isResponse(body)) {
		return body;
	}

	const existing = await getSellableProduct(c.env.DB, body.id);
	if (!existing) {
		return fail(c, "Not Found", 404);
	}

	await c.env.DB.prepare(
		`UPDATE miniprogram_sellable_products
		 SET is_delete = 1
		 WHERE id = ? AND is_delete = 0`,
	)
		.bind(body.id)
		.run();

	return ok(c, await getSellableProduct(c.env.DB, body.id, true));
});

router.post("/coffee-cards/read", async (c: AppContext) => {
	const body = await parseBody(
		c,
		z.object({ id: z.number().int().positive() }),
	);
	if (isResponse(body)) {
		return body;
	}

	const row = await c.env.DB.prepare(
		`SELECT *
		 FROM miniprogram_coffee_cards
		 WHERE id = ? AND is_delete = 0`,
	)
		.bind(body.id)
		.first<Parameters<typeof deserializeMiniprogramCoffeeCard>[0]>();

	return row
		? ok(c, deserializeMiniprogramCoffeeCard(row))
		: fail(c, "Not Found", 404);
});

async function getOrderUser(
	db: D1Database,
	id: string,
	includeDeleted = false,
) {
	return db
		.prepare(
			`SELECT *
			 FROM miniprogram_order_users
			 WHERE id = ? ${includeDeleted ? "" : "AND is_delete = 0"}`,
		)
		.bind(id)
		.first<z.infer<typeof miniprogramOrderUserRowSchema>>();
}

async function getSellableProduct(
	db: D1Database,
	id: string,
	includeDeleted = false,
) {
	const row = await db
		.prepare(
			`SELECT *
			 FROM miniprogram_sellable_products
			 WHERE id = ? ${includeDeleted ? "" : "AND is_delete = 0"}`,
		)
		.bind(id)
		.first<Parameters<typeof deserializeMiniprogramSellable>[0]>();

	return row ? deserializeMiniprogramSellable(row) : null;
}

async function getCoffeeCard(
	db: D1Database,
	id: number,
	includeDeleted = false,
) {
	const row = await db
		.prepare(
			`SELECT *
			 FROM miniprogram_coffee_cards
			 WHERE id = ? ${includeDeleted ? "" : "AND is_delete = 0"}`,
		)
		.bind(id)
		.first<Parameters<typeof deserializeMiniprogramCoffeeCard>[0]>();

	return row ? deserializeMiniprogramCoffeeCard(row) : null;
}

async function readJson(c: AppContext) {
	try {
		return await c.req.json();
	} catch {
		return {};
	}
}

async function parseBody<T extends z.ZodTypeAny>(
	c: AppContext,
	schema: T,
): Promise<z.infer<T> | Response> {
	const parsed = schema.safeParse(await readJson(c));
	if (!parsed.success) {
		return c.json(
			{
				code: 400,
				errors: parsed.error.issues.map((issue) => ({
					code: 400,
					message: issue.path.length
						? `${issue.path.join(".")}: ${issue.message}`
						: issue.message,
				})),
			},
			400,
		);
	}

	return parsed.data;
}

function isResponse(value: unknown): value is Response {
	return value instanceof Response;
}

function setClauseFromBody(
	body: Record<string, unknown>,
	columns: Record<string, string>,
	exclude = new Set(["id"]),
) {
	const assignments: string[] = [];
	const values: unknown[] = [];

	for (const [key, value] of Object.entries(body)) {
		if (exclude.has(key) || value === undefined || !(key in columns)) {
			continue;
		}

		assignments.push(`${columns[key]} = ?`);
		values.push(value);
	}

	return { assignments, values };
}

async function handleMiniprogramError(c: AppContext, error: unknown) {
	if (
		error instanceof MiniprogramOrderError ||
		error instanceof MiniprogramClientError
	) {
		return fail(c, error.message, error.status);
	}

	throw error;
}

export const miniprogramAdminRouter = fromHono(router);

import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import {
	findActiveSellableProduct,
	replaceSellableProductCatalogRefs,
	sellableProductIdBodySchema,
	sellableProductRowSchema,
} from "../../models/luckySellableProducts";
import {
	listLuckinProducts,
	listRandomLuckinProducts,
	luckinProductRowSchema,
	upsertLuckinProducts,
} from "../../models/luckyProducts";
import { fail, ok } from "../../shared/responses";
import { AppContext } from "../../types";
import {
	forwardLuckinMcpToolForSellableProduct,
	LuckinMcpForwardError,
} from "./luckinMcp";

const defaultCatalogQueries = ["美式", "拿铁"] as const;

export const catalogListBodySchema = sellableProductIdBodySchema;

export const catalogSyncBodySchema = sellableProductIdBodySchema.extend({
	deptId: z.number().int(),
	queries: z.array(z.string().min(1)).min(1).optional(),
});

export type CatalogSyncBody = z.infer<typeof catalogSyncBodySchema>;

export class LuckinCatalogError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404 | 502 = 400,
	) {
		super(message);
	}
}

async function ensureSellableProduct(db: D1Database, id: string) {
	const sellableProduct = await findActiveSellableProduct(db, id);

	if (!sellableProduct) {
		throw new LuckinCatalogError("Not Found", 404);
	}

	return sellableProduct;
}

function normalizeProductList(result: unknown): unknown[] {
	const parsed = z.array(z.unknown()).safeParse(result);

	if (parsed.success) {
		return parsed.data;
	}

	const nestedList = z
		.object({
			productList: z.array(z.unknown()),
		})
		.safeParse(result);

	return nestedList.success ? nestedList.data.productList : [];
}

export async function syncLuckinCatalogForSellableProduct(
	db: D1Database,
	fetcher: typeof fetch,
	input: CatalogSyncBody,
) {
	const queries = input.queries ?? [...defaultCatalogQueries];
	const syncedProducts: unknown[] = [];

	for (const query of queries) {
		const result = await forwardLuckinMcpToolForSellableProduct(db, fetcher, {
			id: input.id,
			sign: input.sign,
			toolName: "searchProductForMcp",
			arguments: {
				deptId: input.deptId,
				query,
			},
		});
		const products = normalizeProductList(result);

		await upsertLuckinProducts(db, products, query);
		syncedProducts.push(...products);
	}

	return listLuckinProducts(db);
}

class CatalogList extends OpenAPIRoute {
	schema = {
		tags: ["Orders"],
		summary: "List locally synced Luckin catalog products",
		request: {
			body: contentJson(catalogListBodySchema),
		},
		responses: {
			"200": {
				description: "Local Luckin catalog products",
				...contentJson(z.array(luckinProductRowSchema)),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();

		try {
			await ensureSellableProduct(c.env.DB, data.body.id);
			return ok(c, await listLuckinProducts(c.env.DB));
		} catch (error) {
			if (error instanceof LuckinCatalogError) {
				return fail(c, error.message, error.status);
			}

			throw error;
		}
	}
}

class CatalogSync extends OpenAPIRoute {
	schema = {
		tags: ["Orders"],
		summary: "Sync Luckin catalog products through the order user's token",
		request: {
			body: contentJson(catalogSyncBodySchema),
		},
		responses: {
			"200": {
				description: "Synced Luckin catalog products",
				...contentJson(z.array(luckinProductRowSchema)),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();

		try {
			return ok(
				c,
				await syncLuckinCatalogForSellableProduct(c.env.DB, fetch, data.body),
			);
		} catch (error) {
			if (error instanceof LuckinMcpForwardError) {
				return fail(c, error.message, error.status);
			}

			throw error;
		}
	}
}

class CatalogRepairSellable extends OpenAPIRoute {
	schema = {
		tags: ["Orders"],
		summary: "Repair a sellable product row with real local catalog products",
		request: {
			body: contentJson(sellableProductIdBodySchema),
		},
		responses: {
			"200": {
				description: "Repaired sellable product",
				...contentJson(sellableProductRowSchema),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();

		try {
			const sellableProduct = await ensureSellableProduct(c.env.DB, data.body.id);
			const products = await listRandomLuckinProducts(
				c.env.DB,
				sellableProduct.sellable_quantity,
			);

			if (products.length === 0) {
				return fail(c, "No catalog products available", 400);
			}

			return ok(
				c,
				await replaceSellableProductCatalogRefs(c.env.DB, data.body.id, products),
			);
		} catch (error) {
			if (error instanceof LuckinCatalogError) {
				return fail(c, error.message, error.status);
			}

			throw error;
		}
	}
}

export { CatalogList, CatalogRepairSellable, CatalogSync };


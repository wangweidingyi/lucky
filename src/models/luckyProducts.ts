import { z } from "zod";

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

export const luckinProductInputSchema = z
	.object({
		productId: z.number().int().positive(),
		productName: z.string().min(1),
		skuCode: z.string().min(1),
		pictureUrl: z.string().optional().nullable(),
		initialPrice: z.number().optional().nullable(),
		estimatePrice: z.number().optional().nullable(),
		tags: z.array(z.string()).optional().nullable(),
		productAttrs: z.array(productAttrSchema).optional().nullable(),
	})
	.passthrough();

export const luckinProductRowSchema = z.object({
	id: z.number().int(),
	productId: z.number().int().positive(),
	productName: z.string(),
	skuCode: z.string(),
	pictureUrl: z.string().nullable(),
	initialPrice: z.number().nullable(),
	estimatePrice: z.number().nullable(),
	tags: z.array(z.string()),
	attrs: z.array(productAttrSchema),
	raw: z.record(jsonValueSchema),
	sourceQuery: z.string().nullable(),
	lastSyncedAt: z.string(),
	isDelete: z.number().int(),
});

export type LuckinProductInput = z.infer<typeof luckinProductInputSchema>;
export type LuckinProductRow = z.infer<typeof luckinProductRowSchema>;

type LuckinProductDbRow = {
	id: number;
	product_id: number;
	sku_code: string;
	product_name: string;
	picture_url: string | null;
	initial_price: number | null;
	estimate_price: number | null;
	tags: string;
	attrs: string;
	raw: string;
	source_query: string | null;
	last_synced_at: string;
	is_delete: number;
};

function parseJson<T>(value: string, fallback: T): T {
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

export function deserializeLuckinProduct(row: LuckinProductDbRow): LuckinProductRow {
	return {
		id: row.id,
		productId: row.product_id,
		productName: row.product_name,
		skuCode: row.sku_code,
		pictureUrl: row.picture_url,
		initialPrice: row.initial_price,
		estimatePrice: row.estimate_price,
		tags: parseJson<string[]>(row.tags, []),
		attrs: parseJson<Array<Record<string, unknown>>>(row.attrs, []),
		raw: parseJson<Record<string, unknown>>(row.raw, {}),
		sourceQuery: row.source_query,
		lastSyncedAt: row.last_synced_at,
		isDelete: row.is_delete,
	};
}

export async function upsertLuckinProducts(
	db: D1Database,
	products: Array<unknown>,
	sourceQuery: string | null = null,
) {
	const parsedProducts = products
		.map((product) => luckinProductInputSchema.safeParse(product))
		.filter((result): result is z.SafeParseSuccess<LuckinProductInput> => result.success)
		.map((result) => result.data);

	for (const product of parsedProducts) {
		await db
			.prepare(
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
				product.productId,
				product.skuCode,
				product.productName,
				product.pictureUrl ?? null,
				product.initialPrice ?? null,
				product.estimatePrice ?? null,
				JSON.stringify(product.tags ?? []),
				JSON.stringify(product.productAttrs ?? []),
				JSON.stringify(product),
				sourceQuery,
			)
			.run();
	}

	return parsedProducts.length;
}

export async function listLuckinProducts(db: D1Database) {
	const result = await db
		.prepare(
			`SELECT *
			 FROM lucky_products
			 WHERE is_delete = 0
			 ORDER BY product_name ASC, product_id ASC, sku_code ASC`,
		)
		.all<LuckinProductDbRow>();

	return result.results.map(deserializeLuckinProduct);
}

export async function listRandomLuckinProducts(db: D1Database, limit: number) {
	const result = await db
		.prepare(
			`SELECT *
			 FROM lucky_products
			 WHERE is_delete = 0
			 ORDER BY RANDOM()
			 LIMIT ?`,
		)
		.bind(limit)
		.all<LuckinProductDbRow>();

	return result.results.map(deserializeLuckinProduct);
}


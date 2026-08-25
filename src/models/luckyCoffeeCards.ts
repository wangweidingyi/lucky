import { z } from "zod";
import { idSchema } from "./LuckyOrderUsers";
import { openApiJsonObjectSchema } from "../shared/openapiSchemas";

export const coffeeCardRowSchema = z.object({
	id: z.number().int(),
	orderUserId: idSchema,
	cafeKuId: z.string(),
	couponNo: z.string().nullable(),
	coffeeVoucherType: z.number().int(),
	cardName: z.string().nullable(),
	usableQuantity: z.number().int(),
	syncedProductCount: z.number().int(),
	generatedSellableCount: z.number().int(),
	lastSyncedAt: z.string(),
	raw: openApiJsonObjectSchema,
	isDelete: z.number().int(),
});

export type CoffeeCardRow = z.infer<typeof coffeeCardRowSchema>;

type CoffeeCardDbRow = {
	id: number;
	order_user_id: string;
	cafe_ku_id: string;
	coupon_no: string | null;
	coffee_voucher_type: number;
	card_name: string | null;
	usable_quantity: number;
	synced_product_count: number;
	generated_sellable_count: number;
	last_synced_at: string;
	raw: string;
	is_delete: number;
};

function parseJson<T>(value: string, fallback: T): T {
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

export function deserializeCoffeeCard(row: CoffeeCardDbRow): CoffeeCardRow {
	return {
		id: row.id,
		orderUserId: row.order_user_id,
		cafeKuId: row.cafe_ku_id,
		couponNo: row.coupon_no,
		coffeeVoucherType: row.coffee_voucher_type,
		cardName: row.card_name,
		usableQuantity: row.usable_quantity,
		syncedProductCount: row.synced_product_count,
		generatedSellableCount: row.generated_sellable_count,
		lastSyncedAt: row.last_synced_at,
		raw: parseJson<Record<string, unknown>>(row.raw, {}),
		isDelete: row.is_delete,
	};
}

export async function listCoffeeCards(db: D1Database, orderUserId?: string) {
	const query = orderUserId
		? {
				sql: `SELECT *
				 FROM lucky_coffee_cards
				 WHERE is_delete = 0 AND order_user_id = ?
				 ORDER BY last_synced_at DESC, id DESC`,
				values: [orderUserId],
			}
		: {
				sql: `SELECT *
				 FROM lucky_coffee_cards
				 WHERE is_delete = 0
				 ORDER BY last_synced_at DESC, id DESC`,
				values: [],
			};
	const result = await db
		.prepare(query.sql)
		.bind(...query.values)
		.all<CoffeeCardDbRow>();

	return result.results.map(deserializeCoffeeCard);
}

export async function upsertCoffeeCard(
	db: D1Database,
	card: {
		orderUserId: string;
		cafeKuId: string;
		couponNo?: string | null;
		coffeeVoucherType?: number | null;
		cardName?: string | null;
		usableQuantity?: number | null;
		syncedProductCount?: number | null;
		generatedSellableCount?: number | null;
		raw?: Record<string, unknown>;
	},
) {
	await db
		.prepare(
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
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 0)
			ON CONFLICT(order_user_id, cafe_ku_id) DO UPDATE SET
				coupon_no = excluded.coupon_no,
				coffee_voucher_type = excluded.coffee_voucher_type,
				card_name = excluded.card_name,
				usable_quantity = excluded.usable_quantity,
				synced_product_count = excluded.synced_product_count,
				generated_sellable_count = excluded.generated_sellable_count,
				last_synced_at = CURRENT_TIMESTAMP,
				raw = excluded.raw,
				is_delete = 0`,
		)
		.bind(
			card.orderUserId,
			card.cafeKuId,
			card.couponNo ?? null,
			card.coffeeVoucherType ?? 0,
			card.cardName ?? null,
			card.usableQuantity ?? 1,
			card.syncedProductCount ?? 0,
			card.generatedSellableCount ?? 0,
			JSON.stringify(card.raw ?? {}),
		)
		.run();

	return findCoffeeCard(db, card.orderUserId, card.cafeKuId);
}

export async function findCoffeeCard(
	db: D1Database,
	orderUserId: string,
	cafeKuId: string,
) {
	const row = await db
		.prepare(
			`SELECT *
			 FROM lucky_coffee_cards
			 WHERE order_user_id = ? AND cafe_ku_id = ? AND is_delete = 0`,
		)
		.bind(orderUserId, cafeKuId)
		.first<CoffeeCardDbRow>();

	return row ? deserializeCoffeeCard(row) : null;
}

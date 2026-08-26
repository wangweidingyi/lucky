import { z } from "zod";
import { openApiJsonObjectSchema } from "../shared/openapiSchemas";
import { miniprogramIdSchema } from "./miniprogramOrderUsers";

export const miniprogramCoffeeCardRowSchema = z.object({
  id: z.number().int(),
  orderUserId: miniprogramIdSchema,
  cafeKuId: z.string(),
  couponNo: z.string().nullable(),
  couponType: z.number().int(),
  coffeeVoucherType: z.number().int(),
  cardName: z.string().nullable(),
  usableQuantity: z.number().int(),
  generatedSellableCount: z.number().int(),
  lastSyncedAt: z.string(),
  raw: openApiJsonObjectSchema,
  isDelete: z.number().int(),
});

export type MiniprogramCoffeeCardRow = z.infer<
  typeof miniprogramCoffeeCardRowSchema
>;

type MiniprogramCoffeeCardDbRow = {
  id: number;
  order_user_id: string;
  cafe_ku_id: string;
  coupon_no: string | null;
  coupon_type: number;
  coffee_voucher_type: number;
  card_name: string | null;
  usable_quantity: number;
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

export function deserializeMiniprogramCoffeeCard(
  row: MiniprogramCoffeeCardDbRow,
): MiniprogramCoffeeCardRow {
  return {
    id: row.id,
    orderUserId: row.order_user_id,
    cafeKuId: row.cafe_ku_id,
    couponNo: row.coupon_no,
    couponType: row.coupon_type,
    coffeeVoucherType: row.coffee_voucher_type,
    cardName: row.card_name,
    usableQuantity: row.usable_quantity,
    generatedSellableCount: row.generated_sellable_count,
    lastSyncedAt: row.last_synced_at,
    raw: parseJson<Record<string, unknown>>(row.raw, {}),
    isDelete: row.is_delete,
  };
}

export async function listMiniprogramCoffeeCards(
  db: D1Database,
  orderUserId?: string,
) {
  const query = orderUserId
    ? {
        sql: `SELECT *
				 FROM miniprogram_coffee_cards
				 WHERE is_delete = 0 AND order_user_id = ?
				 ORDER BY last_synced_at DESC, id DESC`,
        values: [orderUserId],
      }
    : {
        sql: `SELECT *
				 FROM miniprogram_coffee_cards
				 WHERE is_delete = 0
				 ORDER BY last_synced_at DESC, id DESC`,
        values: [],
      };

  const result = await db
    .prepare(query.sql)
    .bind(...query.values)
    .all<MiniprogramCoffeeCardDbRow>();

  return result.results.map(deserializeMiniprogramCoffeeCard);
}

export async function findMiniprogramCoffeeCardById(
  db: D1Database,
  id: number,
) {
  const row = await db
    .prepare(
      `SELECT *
			 FROM miniprogram_coffee_cards
			 WHERE id = ? AND is_delete = 0`,
    )
    .bind(id)
    .first<MiniprogramCoffeeCardDbRow>();

  return row ? deserializeMiniprogramCoffeeCard(row) : null;
}

export async function upsertMiniprogramCoffeeCard(
  db: D1Database,
  card: {
    orderUserId: string;
    cafeKuId: string;
    couponNo?: string | null;
    couponType?: number | null;
    coffeeVoucherType?: number | null;
    cardName?: string | null;
    usableQuantity?: number | null;
    generatedSellableCount?: number | null;
    raw?: Record<string, unknown>;
  },
) {
  await db
    .prepare(
      `INSERT INTO miniprogram_coffee_cards (
				order_user_id,
				cafe_ku_id,
				coupon_no,
				coupon_type,
				coffee_voucher_type,
				card_name,
				usable_quantity,
				generated_sellable_count,
				last_synced_at,
				raw,
				is_delete
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 0)
			ON CONFLICT(order_user_id, cafe_ku_id) DO UPDATE SET
				coupon_no = excluded.coupon_no,
				coupon_type = excluded.coupon_type,
				coffee_voucher_type = excluded.coffee_voucher_type,
				card_name = excluded.card_name,
				usable_quantity = excluded.usable_quantity,
				generated_sellable_count = excluded.generated_sellable_count,
				last_synced_at = CURRENT_TIMESTAMP,
				raw = excluded.raw,
				is_delete = 0`,
    )
    .bind(
      card.orderUserId,
      card.cafeKuId,
      card.couponNo ?? null,
      card.couponType ?? 0,
      card.coffeeVoucherType ?? 0,
      card.cardName ?? null,
      card.usableQuantity ?? 1,
      card.generatedSellableCount ?? 0,
      JSON.stringify(card.raw ?? {}),
    )
    .run();

  const row = await db
    .prepare(
      `SELECT *
			 FROM miniprogram_coffee_cards
			 WHERE order_user_id = ? AND cafe_ku_id = ? AND is_delete = 0`,
    )
    .bind(card.orderUserId, card.cafeKuId)
    .first<MiniprogramCoffeeCardDbRow>();

  return row ? deserializeMiniprogramCoffeeCard(row) : null;
}

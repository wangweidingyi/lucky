import { z } from "zod";
import { miniprogramCoffeeCardRowSchema } from "./miniprogramCoffeeCards";
import { miniprogramIdSchema } from "./miniprogramOrderUsers";

export const miniprogramSellableIdSchema = z
  .string()
  .regex(/^[0-9A-Z_a-z-]{31}$/);
export const miniprogramSellableSignSchema = z
  .string()
  .regex(/^[0-9A-Z_a-z-]{31}$/);
export const miniprogramSellableStatusSchema = z.enum([
  "waiting",
  "pending",
  "done",
]);

export const miniprogramSellableRowSchema = z.object({
  id: miniprogramSellableIdSchema,
  coffeeCardId: z.number().int(),
  sellableQuantity: z.number().int(),
  status: miniprogramSellableStatusSchema,
  orderUserId: miniprogramIdSchema,
  thirdPartyRemarkId: z.string().nullable(),
  luckinOrderId: z.string().nullable(),
  selectedProductId: z.number().int().nullable(),
  selectedSkuCode: z.string().nullable(),
  selectedProductName: z.string().nullable(),
  orderedAt: z.string().nullable(),
  isDelete: z.number().int(),
});

export const miniprogramSellableWithCardSchema =
  miniprogramSellableRowSchema.extend({
    coffeeCard: miniprogramCoffeeCardRowSchema,
  });

export const miniprogramSellableIdBodySchema = z.object({
  id: miniprogramSellableIdSchema,
  sign: miniprogramSellableSignSchema,
});

export type MiniprogramSellableRow = z.infer<
  typeof miniprogramSellableRowSchema
>;
export type MiniprogramSellableWithCard = z.infer<
  typeof miniprogramSellableWithCardSchema
>;

type MiniprogramSellableDbRow = {
  id: string;
  coffee_card_id: number;
  sellable_quantity: number;
  status: "waiting" | "pending" | "done";
  order_user_id: string;
  third_party_remark_id: string | null;
  luckin_order_id: string | null;
  selected_product_id: number | null;
  selected_sku_code: string | null;
  selected_product_name: string | null;
  ordered_at: string | null;
  is_delete: number;
};

type MiniprogramSellableWithCardDbRow = MiniprogramSellableDbRow & {
  card_order_user_id: string;
  cafe_ku_id: string;
  coupon_no: string | null;
  coupon_type: number;
  coffee_voucher_type: number;
  card_name: string | null;
  usable_quantity: number;
  generated_sellable_count: number;
  last_synced_at: string;
  card_raw: string;
  card_is_delete: number;
};

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function deserializeMiniprogramSellable(
  row: MiniprogramSellableDbRow,
): MiniprogramSellableRow {
  return {
    id: row.id,
    coffeeCardId: row.coffee_card_id,
    sellableQuantity: row.sellable_quantity,
    status: row.status,
    orderUserId: row.order_user_id,
    thirdPartyRemarkId: row.third_party_remark_id,
    luckinOrderId: row.luckin_order_id,
    selectedProductId: row.selected_product_id,
    selectedSkuCode: row.selected_sku_code,
    selectedProductName: row.selected_product_name,
    orderedAt: row.ordered_at,
    isDelete: row.is_delete,
  };
}

export function deserializeMiniprogramSellableWithCard(
  row: MiniprogramSellableWithCardDbRow,
): MiniprogramSellableWithCard {
  return {
    ...deserializeMiniprogramSellable(row),
    coffeeCard: {
      id: row.coffee_card_id,
      orderUserId: row.card_order_user_id,
      cafeKuId: row.cafe_ku_id,
      couponNo: row.coupon_no,
      couponType: row.coupon_type,
      coffeeVoucherType: row.coffee_voucher_type,
      cardName: row.card_name,
      usableQuantity: row.usable_quantity,
      generatedSellableCount: row.generated_sellable_count,
      lastSyncedAt: row.last_synced_at,
      raw: parseJson<Record<string, unknown>>(row.card_raw, {}),
      isDelete: row.card_is_delete,
    },
  };
}

export async function findActiveMiniprogramSellable(
  db: D1Database,
  id: string,
) {
  const row = await db
    .prepare(
      `SELECT *
			 FROM miniprogram_sellable_products
			 WHERE id = ? AND is_delete = 0`,
    )
    .bind(id)
    .first<MiniprogramSellableDbRow>();

  return row ? deserializeMiniprogramSellable(row) : null;
}

export async function findActiveMiniprogramSellableWithCard(
  db: D1Database,
  id: string,
) {
  const row = await db
    .prepare(
      `SELECT
				s.*,
				c.order_user_id AS card_order_user_id,
				c.cafe_ku_id,
				c.coupon_no,
				c.coupon_type,
				c.coffee_voucher_type,
				c.card_name,
				c.usable_quantity,
				c.generated_sellable_count,
				c.last_synced_at,
				c.raw AS card_raw,
				c.is_delete AS card_is_delete
			 FROM miniprogram_sellable_products s
			 JOIN miniprogram_coffee_cards c ON c.id = s.coffee_card_id
			 WHERE s.id = ? AND s.is_delete = 0 AND c.is_delete = 0`,
    )
    .bind(id)
    .first<MiniprogramSellableWithCardDbRow>();

  return row ? deserializeMiniprogramSellableWithCard(row) : null;
}

export async function markMiniprogramSellableDone(
  db: D1Database,
  input: {
    id: string;
    orderId: string | null;
    productId: number;
    skuCode: string;
    productName?: string | null;
  },
) {
  await db
    .prepare(
      `UPDATE miniprogram_sellable_products
			 SET status = 'done',
				 luckin_order_id = COALESCE(?, luckin_order_id),
				 selected_product_id = ?,
				 selected_sku_code = ?,
				 selected_product_name = ?,
				 ordered_at = CURRENT_TIMESTAMP
			 WHERE id = ? AND is_delete = 0 AND status IN ('waiting', 'pending')`,
    )
    .bind(
      input.orderId,
      input.productId,
      input.skuCode,
      input.productName ?? null,
      input.id,
    )
    .run();

  return findActiveMiniprogramSellable(db, input.id);
}

import { z } from "zod";
import { idSchema } from "./LuckyOrderUsers";

const optionalNullableString = z.string().optional().nullable();
export const sellableProductStatusSchema = z.enum(["waiting", "pending", "done"]);

export const sellableProductRowSchema = z.object({
    id: idSchema,
    sellable_product_ids: z.array(z.string()),
    sellable_sku_codes: z.array(z.string()),
    sellable_quantity: z.number().int().positive(),
    status: sellableProductStatusSchema,
    order_user_id: idSchema,
    third_party_remark_id: z.string().regex(/^[a-zA-Z0-9]{3}$/).nullable(),
    third_party_order_id: z.string().nullable(),
    third_party_product_id: z.string().nullable(),
    is_delete: z.number().int(),
});

export const sellableProductCreateBodySchema = z.object({
    sellable_product_ids: z.array(z.string()).min(1),
    sellable_sku_codes: z.array(z.string()).min(1),
    sellable_quantity: z.number().int().positive().optional().default(1),
    status: sellableProductStatusSchema.optional().default("waiting"),
    order_user_id: idSchema,
    third_party_remark_id: z
        .string()
        .regex(/^[a-zA-Z0-9]{3}$/)
        .optional()
        .nullable(),
    third_party_order_id: optionalNullableString,
    third_party_product_id: optionalNullableString,
});

export const sellableProductIdBodySchema = z.object({
    id: idSchema,
    sign: z.string().regex(/^[a-zA-Z0-9]{10}$/),
});

export const sellableProductUpdateBodySchema = sellableProductIdBodySchema.extend({
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
    third_party_order_id: optionalNullableString,
    third_party_product_id: optionalNullableString,
});

type SellableProductDbRow = Omit<
    z.infer<typeof sellableProductRowSchema>,
    "sellable_product_ids" | "sellable_sku_codes"
> & {
    sellable_product_ids: string;
    sellable_sku_codes: string;
};

export type SellableProductRow = z.infer<typeof sellableProductRowSchema>;

export function serializeArray(value: string[]) {
    return JSON.stringify(value);
}

export function deserializeSellableProduct(
    row: SellableProductDbRow,
): SellableProductRow {
    return {
        ...row,
        sellable_product_ids: JSON.parse(row.sellable_product_ids),
        sellable_sku_codes: JSON.parse(row.sellable_sku_codes),
    };
}

export async function findActiveSellableProduct(db: D1Database, id: string) {
    const row = await db
        .prepare(
            "SELECT * FROM lucky_sellable_products WHERE id = ? AND is_delete = 0",
        )
        .bind(id)
        .first<SellableProductDbRow>();

    return row ? deserializeSellableProduct(row) : null;
}

export async function findActiveSellableProductByOrderId(
    db: D1Database,
    orderId: string,
) {
    const row = await db
        .prepare(
            "SELECT * FROM lucky_sellable_products WHERE third_party_order_id = ? AND is_delete = 0",
        )
        .bind(orderId)
        .first<SellableProductDbRow>();

    return row ? deserializeSellableProduct(row) : null;
}

export async function replaceSellableProductCatalogRefs(
    db: D1Database,
    id: string,
    products: Array<{ productId: number; skuCode: string }>,
) {
    await db
        .prepare(
            `UPDATE lucky_sellable_products
             SET sellable_product_ids = ?, sellable_sku_codes = ?
             WHERE id = ? AND is_delete = 0`,
        )
        .bind(
            serializeArray(products.map((product) => String(product.productId))),
            serializeArray(products.map((product) => product.skuCode)),
            id,
        )
        .run();

    return findActiveSellableProduct(db, id);
}

export async function markSellableProductDone(
    db: D1Database,
    id: string,
    orderId: string | null,
) {
    await db
        .prepare(
            `UPDATE lucky_sellable_products
             SET status = 'done',
                 third_party_order_id = COALESCE(?, third_party_order_id)
             WHERE id = ? AND is_delete = 0 AND status = 'pending'`,
        )
        .bind(orderId, id)
        .run();

    return findActiveSellableProduct(db, id);
}

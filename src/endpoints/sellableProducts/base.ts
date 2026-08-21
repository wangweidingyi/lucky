import { z } from "zod";
import { idSchema } from "../orderUsers/base";

const optionalNullableString = z.string().optional().nullable();

export const sellableProductRowSchema = z.object({
	id: idSchema,
	sellable_product_ids: z.array(z.string()),
	sellable_sku_codes: z.array(z.string()),
	sellable_quantity: z.number().int().positive(),
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
});

export const sellableProductUpdateBodySchema = sellableProductIdBodySchema.extend({
	sellable_product_ids: z.array(z.string()).min(1).optional(),
	sellable_sku_codes: z.array(z.string()).min(1).optional(),
	sellable_quantity: z.number().int().positive().optional(),
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

import { contentJson, OpenAPIRoute } from "chanfana";
import { AppContext } from "../../types";
import { findActiveOrderUser } from "../orderUsers/base";
import { fail, ok } from "../shared/responses";
import {
	findActiveSellableProduct,
	sellableProductRowSchema,
	sellableProductUpdateBodySchema,
	serializeArray,
} from "./base";

const updateColumns = [
	"sellable_product_ids",
	"sellable_sku_codes",
	"sellable_quantity",
	"order_user_id",
	"third_party_remark_id",
	"third_party_order_id",
	"third_party_product_id",
] as const;

export class SellableProductUpdate extends OpenAPIRoute {
	schema = {
		tags: ["Sellable Products"],
		summary: "Update a sellable product",
		request: {
			body: contentJson(sellableProductUpdateBodySchema),
		},
		responses: {
			"200": {
				description: "Updated sellable product",
				...contentJson(sellableProductRowSchema),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const existing = await findActiveSellableProduct(c.env.DB, data.body.id);

		if (!existing) {
			return fail(c, "Not Found", 404);
		}

		if (data.body.order_user_id !== undefined) {
			const orderUser = await findActiveOrderUser(c.env.DB, data.body.order_user_id);

			if (!orderUser) {
				return fail(c, "order_user_id does not reference an active order user");
			}
		}

		const updates = updateColumns
			.filter((column) => data.body[column] !== undefined)
			.map((column) => {
				const value = data.body[column];

				if (column === "sellable_product_ids" || column === "sellable_sku_codes") {
					return [column, serializeArray(value as string[])] as const;
				}

				return [column, value] as const;
			});

		if (updates.length > 0) {
			await c.env.DB.prepare(
				`UPDATE lucky_sellable_products
				 SET ${updates.map(([column]) => `${column} = ?`).join(", ")}
				 WHERE id = ? AND is_delete = 0`,
			)
				.bind(...updates.map(([, value]) => value ?? null), data.body.id)
				.run();
		}

		return ok(c, await findActiveSellableProduct(c.env.DB, data.body.id));
	}
}

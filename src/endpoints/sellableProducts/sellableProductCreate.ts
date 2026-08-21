import { contentJson, OpenAPIRoute } from "chanfana";
import { AppContext } from "../../types";
import { findActiveOrderUser } from "../orderUsers/base";
import { generateId } from "../shared/id";
import { fail, ok } from "../shared/responses";
import {
	findActiveSellableProduct,
	sellableProductCreateBodySchema,
	sellableProductRowSchema,
	serializeArray,
} from "./base";

export class SellableProductCreate extends OpenAPIRoute {
	schema = {
		tags: ["Sellable Products"],
		summary: "Create a sellable product",
		request: {
			body: contentJson(sellableProductCreateBodySchema),
		},
		responses: {
			"201": {
				description: "Created sellable product",
				...contentJson(sellableProductRowSchema),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const orderUser = await findActiveOrderUser(c.env.DB, data.body.order_user_id);

		if (!orderUser) {
			return fail(c, "order_user_id does not reference an active order user");
		}

		const id = generateId();

		await c.env.DB.prepare(
			`INSERT INTO lucky_sellable_products (
				id,
				sellable_product_ids,
				sellable_sku_codes,
				sellable_quantity,
				order_user_id,
				third_party_remark_id,
				third_party_order_id,
				third_party_product_id
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(
				id,
				serializeArray(data.body.sellable_product_ids),
				serializeArray(data.body.sellable_sku_codes),
				data.body.sellable_quantity,
				data.body.order_user_id,
				data.body.third_party_remark_id ?? null,
				data.body.third_party_order_id ?? null,
				data.body.third_party_product_id ?? null,
			)
			.run();

		return ok(c, await findActiveSellableProduct(c.env.DB, id), 201);
	}
}

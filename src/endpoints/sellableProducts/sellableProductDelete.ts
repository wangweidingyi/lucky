import { contentJson, OpenAPIRoute } from "chanfana";
import { AppContext } from "../../types";
import { fail, ok } from "../shared/responses";
import {
	findActiveSellableProduct,
	sellableProductIdBodySchema,
	sellableProductRowSchema,
} from "./base";

export class SellableProductDelete extends OpenAPIRoute {
	schema = {
		tags: ["Sellable Products"],
		summary: "Soft delete a sellable product",
		request: {
			body: contentJson(sellableProductIdBodySchema),
		},
		responses: {
			"200": {
				description: "Deleted sellable product",
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

		await c.env.DB.prepare(
			"UPDATE lucky_sellable_products SET is_delete = 1 WHERE id = ?",
		)
			.bind(data.body.id)
			.run();

		return ok(c, { ...existing, is_delete: 1 });
	}
}

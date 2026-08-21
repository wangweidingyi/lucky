import { contentJson, OpenAPIRoute } from "chanfana";
import { AppContext } from "../../types";
import { fail, ok } from "../shared/responses";
import {
	findActiveSellableProduct,
	sellableProductIdBodySchema,
	sellableProductRowSchema,
} from "./base";

export class SellableProductRead extends OpenAPIRoute {
	schema = {
		tags: ["Sellable Products"],
		summary: "Read a sellable product",
		request: {
			body: contentJson(sellableProductIdBodySchema),
		},
		responses: {
			"200": {
				description: "Sellable product",
				...contentJson(sellableProductRowSchema),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const row = await findActiveSellableProduct(c.env.DB, data.body.id);

		if (!row) {
			return fail(c, "Not Found", 404);
		}

		return ok(c, row);
	}
}

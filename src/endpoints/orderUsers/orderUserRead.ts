import { contentJson, OpenAPIRoute } from "chanfana";
import { AppContext } from "../../types";
import { fail, ok } from "../shared/responses";
import { findActiveOrderUser, orderUserIdBodySchema, orderUserRowSchema } from "./base";

export class OrderUserRead extends OpenAPIRoute {
	schema = {
		tags: ["Order Users"],
		summary: "Read an order user",
		request: {
			body: contentJson(orderUserIdBodySchema),
		},
		responses: {
			"200": {
				description: "Order user",
				...contentJson(orderUserRowSchema),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const row = await findActiveOrderUser(c.env.DB, data.body.id);

		if (!row) {
			return fail(c, "Not Found", 404);
		}

		return ok(c, row);
	}
}

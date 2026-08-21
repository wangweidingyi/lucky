import { contentJson, OpenAPIRoute } from "chanfana";
import { AppContext } from "../../types";
import { fail, ok } from "../shared/responses";
import { findActiveOrderUser, orderUserIdBodySchema, orderUserRowSchema } from "./base";

export class OrderUserDelete extends OpenAPIRoute {
	schema = {
		tags: ["Order Users"],
		summary: "Soft delete an order user",
		request: {
			body: contentJson(orderUserIdBodySchema),
		},
		responses: {
			"200": {
				description: "Deleted order user",
				...contentJson(orderUserRowSchema),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const existing = await findActiveOrderUser(c.env.DB, data.body.id);

		if (!existing) {
			return fail(c, "Not Found", 404);
		}

		await c.env.DB.prepare(
			"UPDATE lucky_order_users SET is_delete = 1 WHERE id = ?",
		)
			.bind(data.body.id)
			.run();

		return ok(c, { ...existing, is_delete: 1 });
	}
}

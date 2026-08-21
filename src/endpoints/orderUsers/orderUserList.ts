import { contentJson, OpenAPIRoute } from "chanfana";
import { AppContext } from "../../types";
import { ok } from "../shared/responses";
import { orderUserRowSchema, OrderUserRow } from "./base";

export class OrderUserList extends OpenAPIRoute {
	schema = {
		tags: ["Order Users"],
		summary: "List active order users",
		request: {
			body: contentJson({}),
		},
		responses: {
			"200": {
				description: "Active order users",
				...contentJson(orderUserRowSchema.array()),
			},
		},
	};

	async handle(c: AppContext) {
		const { results } = await c.env.DB.prepare(
			"SELECT * FROM lucky_order_users WHERE is_delete = 0 ORDER BY id DESC",
		).all<OrderUserRow>();

		return ok(c, results);
	}
}

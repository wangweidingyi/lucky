import { contentJson, OpenAPIRoute } from "chanfana";
import { AppContext } from "../../types";
import { generateId } from "../shared/id";
import { ok } from "../shared/responses";
import {
	findActiveOrderUser,
	orderUserCreateBodySchema,
	orderUserRowSchema,
} from "./base";

export class OrderUserCreate extends OpenAPIRoute {
	schema = {
		tags: ["Order Users"],
		summary: "Create an order user",
		request: {
			body: contentJson(orderUserCreateBodySchema),
		},
		responses: {
			"201": {
				description: "Created order user",
				...contentJson(
					orderUserRowSchema.extend({ success: orderUserRowSchema.shape.id }),
				),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const id = generateId();

		await c.env.DB.prepare(
			`INSERT INTO lucky_order_users (id, nickname, token, type, status)
			 VALUES (?, ?, ?, ?, ?)`,
		)
			.bind(
				id,
				data.body.nickname,
				data.body.token,
				data.body.type,
				data.body.status,
			)
			.run();

		return ok(c, await findActiveOrderUser(c.env.DB, id), 201);
	}
}

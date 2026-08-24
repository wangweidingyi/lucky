import { contentJson, OpenAPIRoute } from "chanfana";
import { AppContext } from "../../types";
import { fail, ok } from "../shared/responses";
import {
	findActiveOrderUser,
	orderUserRowSchema,
	orderUserUpdateBodySchema,
} from "./base";

const updateColumns = [
	"nickname",
	"token",
	"type",
	"status",
	"auth_mode",
	"uid",
	"openid",
	"black_box",
	"notify_code",
	"csid",
	"pay_type",
	"miniprogram_version",
	"aes_key",
	"base_url",
	"cookie",
] as const;

export class OrderUserUpdate extends OpenAPIRoute {
	schema = {
		tags: ["Order Users"],
		summary: "Update an order user",
		request: {
			body: contentJson(orderUserUpdateBodySchema),
		},
		responses: {
			"200": {
				description: "Updated order user",
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

		const updates = updateColumns
			.filter((column) => data.body[column] !== undefined)
			.map((column) => [column, data.body[column]] as const);

		if (updates.length > 0) {
			await c.env.DB.prepare(
				`UPDATE lucky_order_users
				 SET ${updates.map(([column]) => `${column} = ?`).join(", ")}
				 WHERE id = ? AND is_delete = 0`,
			)
				.bind(...updates.map(([, value]) => value), data.body.id)
				.run();
		}

		return ok(c, await findActiveOrderUser(c.env.DB, data.body.id));
	}
}

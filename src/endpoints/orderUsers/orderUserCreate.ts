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
			`INSERT INTO lucky_order_users (
				id,
				nickname,
				token,
				type,
				status,
				auth_mode,
				uid,
				openid,
				black_box,
				notify_code,
				csid,
				pay_type,
				miniprogram_version,
				aes_key,
				base_url,
				cookie
			)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
			.bind(
				id,
				data.body.nickname,
				data.body.token,
				data.body.type,
				data.body.status,
				data.body.auth_mode,
				data.body.uid,
				data.body.openid,
				data.body.black_box,
				data.body.notify_code,
				data.body.csid,
				data.body.pay_type,
				data.body.miniprogram_version,
				data.body.aes_key,
				data.body.base_url,
				data.body.cookie,
			)
			.run();

		return ok(c, await findActiveOrderUser(c.env.DB, id), 201);
	}
}

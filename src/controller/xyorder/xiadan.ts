import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { AppContext } from "../../types";
import { fail, ok } from "../../shared/responses";
import {
	findActiveSellableProductByOrderId,
	findActiveSellableProduct,
	sellableProductRowSchema,
} from "../../models/luckySellableProducts";

const xiadanBodySchema = z.object({
	orderId: z.string().min(1),
});

class XiaDan extends OpenAPIRoute {
	schema = {
		tags: ["Xianyu Orders"],
		summary: "Mark an order as pending",
		request: {
			body: contentJson(xiadanBodySchema),
		},
		responses: {
			"200": {
				description: "Order status updated",
				...contentJson(sellableProductRowSchema),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const existing = await findActiveSellableProductByOrderId(
			c.env.DB,
			data.body.orderId,
		);

		if (!existing) {
			return fail(c, "Not Found", 404);
		}

		await c.env.DB.prepare(
			"UPDATE lucky_sellable_products SET status = 'pending' WHERE id = ? AND is_delete = 0",
		)
			.bind(existing.id)
			.run();

		return ok(c, await findActiveSellableProduct(c.env.DB, existing.id));
	}
}

export default XiaDan;

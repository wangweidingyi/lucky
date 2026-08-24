import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { AppContext } from "../../types";
import { ok } from "../shared/responses";
import {
	deserializeSellableProduct,
	sellableProductRowSchema,
} from "./base";

type SellableProductDbRow = {
	id: string;
	sellable_product_ids: string;
	sellable_sku_codes: string;
	sellable_quantity: number;
	status: "waiting" | "pending" | "done";
	order_user_id: string;
	third_party_remark_id: string | null;
	third_party_order_id: string | null;
	third_party_product_id: string | null;
	is_delete: number;
};

export class SellableProductList extends OpenAPIRoute {
	schema = {
		tags: ["Sellable Products"],
		summary: "List active sellable products",
		request: {
			body: contentJson(z.object({})),
		},
		responses: {
			"200": {
				description: "Active sellable products",
				...contentJson(sellableProductRowSchema.array()),
			},
		},
	};

	async handle(c: AppContext) {
		const { results } = await c.env.DB.prepare(
			"SELECT * FROM lucky_sellable_products WHERE is_delete = 0 ORDER BY id DESC",
		).all<SellableProductDbRow>();

		return ok(c, results.map(deserializeSellableProduct));
	}
}

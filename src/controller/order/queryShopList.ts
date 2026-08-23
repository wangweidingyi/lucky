import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { AppContext } from "../../types";
import { fail, ok } from "../../shared/responses";
import { sellableProductIdBodySchema } from "../../models/luckySellableProducts";
import {
	forwardLuckinMcpToolForSellableProduct,
	LuckinMcpForwardError,
} from "./luckinMcp";

export const shopSchema = z.object({
	deptId: z.number().optional(),
	deptName: z.string().optional(),
	address: z.string().optional(),
	deptTags: z.array(z.string()).optional(),
	longitude: z.number().optional(),
	latitude: z.number().optional(),
	workTimeStart: z.string().optional(),
	workTimeEnd: z.string().optional(),
	distance: z.number().optional(),
	number: z.string().optional(),
});

export const queryShopListBodySchema = sellableProductIdBodySchema.extend({
	deptName: z.string().optional().default(""),
	longitude: z.number(),
	latitude: z.number(),
});

export type QueryShopListBody = z.infer<typeof queryShopListBodySchema>;
export type Shop = z.infer<typeof shopSchema>;

export class QueryShopListError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404 | 502 = 502,
	) {
		super(message);
	}
}

export async function queryShopListForSellableProduct(
	db: D1Database,
	fetcher: typeof fetch,
	input: QueryShopListBody,
): Promise<Shop[]> {
	try {
		const result = await forwardLuckinMcpToolForSellableProduct(db, fetcher, {
			id: input.id,
			sign: input.sign,
			toolName: "queryShopList",
			arguments: {
				deptName: input.deptName,
				longitude: input.longitude,
				latitude: input.latitude,
			},
		});

		const shopList = z.array(shopSchema).safeParse(result);

		if (!shopList.success) {
			throw new QueryShopListError("Invalid Luckin shop list response", 502);
		}

		return shopList.data;
	} catch (error) {
		if (error instanceof LuckinMcpForwardError) {
			throw new QueryShopListError(error.message, error.status);
		}

		throw error;
	}
}

class QueryShopList extends OpenAPIRoute {
	schema = {
		tags: ["Orders"],
		summary: "Forward queryShopList with the order user's Luckin token",
		request: {
			body: contentJson(queryShopListBodySchema),
		},
		responses: {
			"200": {
				description: "Luckin shop list",
				...contentJson(z.array(shopSchema)),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();

		try {
			return ok(
				c,
				await queryShopListForSellableProduct(c.env.DB, fetch, data.body),
			);
		} catch (error) {
			if (error instanceof QueryShopListError) {
				return fail(c, error.message, error.status);
			}

			throw error;
		}
	}
}

export default QueryShopList;

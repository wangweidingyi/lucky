import { contentJson, OpenAPIRoute } from "chanfana";
import { AppContext } from "../../types";
import { generateId } from "../../shared/id";
import { ok, fail} from "../../shared/responses";
import {
	findActiveSellableProduct,
	sellableProductIdBodySchema,
	sellableProductRowSchema,
} from "../../models/luckySellableProducts";

 class OrderDetailRead extends OpenAPIRoute {
    schema = {
        tags: ["Orders"],
        summary: "Read a order detail",
        request: {
            body: contentJson(sellableProductIdBodySchema),
        },
        responses: {
            "200": {
                description: "Order detail",
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

export default OrderDetailRead;
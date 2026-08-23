import { ApiException, fromHono } from "chanfana";
import { Hono } from "hono";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { orderUsersRouter } from "./endpoints/orderUsers/router";
import { sellableProductsRouter } from "./endpoints/sellableProducts/router";
import { orderRouter } from "./controller/order/order";
import { xyOrderRouter } from "./controller/xyorder/xyorder";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

app.onError((err, c) => {
	if (err instanceof ApiException) {
		// If it's a Chanfana ApiException, let Chanfana handle the response
		return c.json(
			{ success: false, errors: err.buildResponse() },
			err.status as ContentfulStatusCode,
		);
	}

	console.error("Global error handler caught:", err); // Log the error if it's not known

	// For other errors, return a generic 500 response
	return c.json(
		{
			success: false,
			errors: [{ code: 7000, message: "Internal Server Error" }],
		},
		500,
	);
});

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
	schema: {
		info: {
			title: "Lucky Ordering API",
			version: "2.0.0",
			description: "POST-only CRUD API for Luckin proxy ordering.",
		},
	},
});

openapi.route("/order-users", orderUsersRouter);
openapi.route("/sellable-products", sellableProductsRouter);

openapi.route("/order", orderRouter);
openapi.route("/xy/order", xyOrderRouter);


// Export the Hono app
export default app;

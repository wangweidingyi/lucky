import { ApiException, fromHono, getSwaggerUI } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ContentfulStatusCode } from "hono/utils/http-status";
// import { orderUsersRouter } from "./endpoints/orderUsers/router";
// import { sellableProductsRouter } from "./endpoints/sellableProducts/router";
import { orderRouter } from "./controller/order/order";
import { xyOrderRouter } from "./controller/xyorder/xyorder";
import { lkadminRouter } from "./controller/lkadmin/lkadmin";
import { appLogger } from "./shared/logger";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();
const allowedCorsOrigins = [
	"http://localhost:5173",
	"http://localhost:5174",
	"http://localhost:5175",
	"http://localhost:5176",
	"https://lk.maerai.com",
	"https://adminlkk.maerai.com",
];

app.use(
	"*",
	cors({
		origin: allowedCorsOrigins,
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		maxAge: 86400,
	}),
);

app.onError((err, c) => {
	if (err instanceof ApiException) {
		// If it's a Chanfana ApiException, let Chanfana handle the response
		return c.json(
			{ success: false, errors: err.buildResponse() },
			err.status as ContentfulStatusCode,
		);
	}

	appLogger.error("src/index.ts:app.onError", "request.unhandled_error", {
		error: err,
	});

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
	docs_url: null,
	redoc_url: null,
	openapi_url: null,
	schema: {
		info: {
			title: "Lucky Ordering API",
			version: "2.0.0",
			description: "POST-only CRUD API for Luckin proxy ordering.",
		},
	},
});

// openapi.route("/order-users", orderUsersRouter);
// openapi.route("/sellable-products", sellableProductsRouter);

openapi.route("/order", orderRouter);
openapi.route("/xy/order", xyOrderRouter);
openapi.route("/lkadmin", lkadminRouter);

app.get("/", (c) => {
	if (!isLocalDocumentationRequest(c.req.url)) {
		return c.notFound();
	}

	return c.html(getSwaggerUI("/openapi.json"));
});

app.get("/openapi.json", (c) => {
	if (!isLocalDocumentationRequest(c.req.url)) {
		return c.notFound();
	}

	return c.json((openapi as unknown as { schema: unknown }).schema);
});

function isLocalDocumentationRequest(url: string) {
	return ["localhost", "127.0.0.1", "0.0.0.0", "local.test"].includes(
		new URL(url).hostname,
	);
}

// Export the Hono app
export default app;

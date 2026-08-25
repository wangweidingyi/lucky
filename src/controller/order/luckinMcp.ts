import { contentJson, OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { findActiveOrderUser } from "../../models/LuckyOrderUsers";
import {
	findActiveSellableProduct,
	sellableProductIdBodySchema,
} from "../../models/luckySellableProducts";
import { fail, ok } from "../../shared/responses";
import { appLogger } from "../../shared/logger";
import { AppContext } from "../../types";

const mcpUrl = "https://gwmcp.lkcoffee.com/order/user/mcp";

export const mcpForwardBaseBodySchema = sellableProductIdBodySchema;

export class LuckinMcpForwardError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404 | 502 = 502,
	) {
		super(message);
	}
}

export async function forwardLuckinMcpToolForSellableProduct(
	db: D1Database,
	fetcher: typeof fetch,
	input: {
		id: string;
		sign: string;
		toolName: string;
		arguments: Record<string, unknown>;
	},
): Promise<unknown> {
	const sellableProduct = await findActiveSellableProduct(db, input.id);

	if (!sellableProduct) {
		throw new LuckinMcpForwardError("Not Found", 404);
	}

	const orderUser = await findActiveOrderUser(db, sellableProduct.order_user_id);

	if (!orderUser) {
		throw new LuckinMcpForwardError("Order user not found", 404);
	}

	const requestPayload = {
		jsonrpc: "2.0",
		id: input.toolName,
		method: "tools/call",
		params: {
			name: input.toolName,
			arguments: input.arguments,
		},
	};
	const headers = {
		Accept: "application/json, text/event-stream",
		Authorization: `Bearer ${orderUser.token}`,
		"Content-Type": "application/json",
	};

	appLogger.info(
		"src/controller/order/luckinMcp.ts:forwardLuckinMcpToolForSellableProduct",
		"third_party.request",
		{
			url: mcpUrl,
			method: "POST",
			toolName: input.toolName,
			headers,
			payload: requestPayload,
		},
	);

	let mcpResponse: Response;
	try {
		mcpResponse = await fetcher(mcpUrl, {
			method: "POST",
			headers,
			body: JSON.stringify(requestPayload),
		});
	} catch (error) {
		appLogger.error(
			"src/controller/order/luckinMcp.ts:forwardLuckinMcpToolForSellableProduct",
			"third_party.request.failed",
			{
				url: mcpUrl,
				toolName: input.toolName,
				error,
			},
		);
		throw new LuckinMcpForwardError("Luckin MCP request failed", 502);
	}

	let responseText: string;
	try {
		responseText = await mcpResponse.text();
	} catch (error) {
		appLogger.error(
			"src/controller/order/luckinMcp.ts:forwardLuckinMcpToolForSellableProduct",
			"third_party.response.read_failed",
			{
				url: mcpUrl,
				toolName: input.toolName,
				status: mcpResponse.status,
				error,
			},
		);
		throw new LuckinMcpForwardError("Luckin MCP request failed", 502);
	}

	appLogger.info(
		"src/controller/order/luckinMcp.ts:forwardLuckinMcpToolForSellableProduct",
		"third_party.response.http",
		{
			url: mcpUrl,
			toolName: input.toolName,
			status: mcpResponse.status,
			ok: mcpResponse.ok,
			contentType: mcpResponse.headers.get("content-type"),
			rawResponse: responseText,
		},
	);

	if (!mcpResponse.ok) {
		appLogger.error(
			"src/controller/order/luckinMcp.ts:forwardLuckinMcpToolForSellableProduct",
			"third_party.response.failed",
			{
				url: mcpUrl,
				toolName: input.toolName,
				status: mcpResponse.status,
				contentType: mcpResponse.headers.get("content-type"),
				rawResponse: responseText,
			},
		);
		throw new LuckinMcpForwardError("Luckin MCP request failed", 502);
	}

	let payload: unknown;
	let toolData: unknown;
	try {
		payload = parseMcpResponseText(
			responseText,
			mcpResponse.headers.get("content-type"),
		);
		toolData = extractToolData(payload);
	} catch (error) {
		appLogger.error(
			"src/controller/order/luckinMcp.ts:forwardLuckinMcpToolForSellableProduct",
			"third_party.response.invalid",
			{
				url: mcpUrl,
				toolName: input.toolName,
				status: mcpResponse.status,
				contentType: mcpResponse.headers.get("content-type"),
				rawResponse: responseText,
				error,
			},
		);

		if (error instanceof LuckinMcpForwardError) {
			throw error;
		}

		throw new LuckinMcpForwardError("Invalid Luckin MCP response", 502);
	}

	appLogger.info(
		"src/controller/order/luckinMcp.ts:forwardLuckinMcpToolForSellableProduct",
		"third_party.response",
		{
			url: mcpUrl,
			toolName: input.toolName,
			responseParsed: payload,
			toolData,
		},
	);

	return toolData;
}

function parseMcpResponseText(text: string, contentType: string | null) {
	if (!text) {
		return null;
	}

	if (contentType?.includes("text/event-stream")) {
		const eventData = text
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice("data:".length).trim())
			.find((line) => line && line !== "[DONE]");

		return eventData ? JSON.parse(eventData) : null;
	}

	return JSON.parse(text);
}

function extractToolData(payload: unknown): unknown {
	if (payload && typeof payload === "object" && "data" in payload) {
		return (payload as { data: unknown }).data;
	}

	const mcpPayload = z
		.object({
			result: z.object({
				content: z.array(
					z.object({
						type: z.string(),
						text: z.string(),
					}),
				),
			}),
		})
		.safeParse(payload);

	if (!mcpPayload.success) {
		throw new LuckinMcpForwardError("Invalid Luckin MCP response", 502);
	}

	const textContent = mcpPayload.data.result.content.find(
		(item) => item.type === "text",
	)?.text;

	if (!textContent) {
		throw new LuckinMcpForwardError("Invalid Luckin MCP response", 502);
	}

	const toolResult = z
		.object({
			data: z.unknown(),
		})
		.safeParse(JSON.parse(textContent));

	if (!toolResult.success) {
		throw new LuckinMcpForwardError("Invalid Luckin tool response", 502);
	}

	return toolResult.data.data;
}

function stripForwardingFields(body: Record<string, unknown>) {
	const args: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(body)) {
		if (key !== "id" && key !== "sign" && value !== undefined) {
			args[key] = value;
		}
	}

	return args;
}

export function createLuckinMcpToolRoute(
	toolName: string,
	bodySchema: z.ZodTypeAny,
	summary: string,
) {
	return class LuckinMcpToolRoute extends OpenAPIRoute {
		schema = {
			tags: ["Orders"],
			summary,
			request: {
				body: contentJson(bodySchema),
			},
			responses: {
				"200": {
					description: `${toolName} result`,
					...contentJson(z.unknown()),
				},
			},
		};

		async handle(c: AppContext) {
			const data = await this.getValidatedData<typeof this.schema>();
			const body = data.body as Record<string, unknown>;

			try {
				return ok(
					c,
					await forwardLuckinMcpToolForSellableProduct(c.env.DB, fetch, {
						id: body.id as string,
						sign: body.sign as string,
						toolName,
						arguments: stripForwardingFields(body),
					}),
				);
			} catch (error) {
				if (error instanceof LuckinMcpForwardError) {
					return fail(c, error.message, error.status);
				}

				throw error;
			}
		}
	};
}

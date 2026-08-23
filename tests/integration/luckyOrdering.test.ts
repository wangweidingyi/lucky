import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
	QueryShopListError,
	queryShopListForSellableProduct,
} from "../../src/controller/order/queryShopList";
import { forwardLuckinMcpToolForSellableProduct } from "../../src/controller/order/luckinMcp";

const idPattern = /^[a-zA-Z0-9]{10}$/;

async function post<T>(path: string, body: Record<string, unknown> = {}) {
	const response = await SELF.fetch(`http://local.test${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	const text = await response.text();

	return {
		response,
		body: text ? parseJson<T>(text) : ({} as T),
	};
}

function parseJson<T>(text: string) {
	try {
		return JSON.parse(text) as T;
	} catch {
		return {} as T;
	}
}

async function createOrderUser(overrides: Record<string, unknown> = {}) {
	const { response, body } = await post<{
		success: boolean;
		result: {
			id: string;
			nickname: string;
			token: string;
			type: string;
			status: string;
			is_delete: number;
		};
	}>("/order-users/create", {
		nickname: "main account",
		token: "luckin-token",
		...overrides,
	});

	expect(response.status).toBe(201);
	expect(body.success).toBe(true);
	return body.result;
}

describe("Lucky ordering API", () => {
	describe("POST /order-users/*", () => {
		it("creates an order user with generated id and defaults", async () => {
			const { response, body } = await post<{
				success: boolean;
				result: {
					id: string;
					nickname: string;
					token: string;
					type: string;
					status: string;
					is_delete: number;
				};
			}>("/order-users/create", {
				nickname: "store buyer",
				token: "token-001",
			});

			expect(response.status).toBe(201);
			expect(body.success).toBe(true);
			expect(body.result).toEqual({
				id: expect.stringMatching(idPattern),
				nickname: "store buyer",
				token: "token-001",
				type: "lucky",
				status: "enabled",
				is_delete: 0,
			});
		});

		it("lists, reads, updates, and soft deletes users through POST bodies", async () => {
			const user = await createOrderUser({
				nickname: "before update",
				status: "disabled",
			});

			const listBefore = await post<{
				success: boolean;
				result: Array<{ id: string; nickname: string }>;
			}>("/order-users/list");
			expect(listBefore.response.status).toBe(200);
			expect(listBefore.body.result).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						id: user.id,
						nickname: "before update",
					}),
				]),
			);

			const readBefore = await post<{
				success: boolean;
				result: { id: string; status: string };
			}>("/order-users/read", { id: user.id });
			expect(readBefore.response.status).toBe(200);
			expect(readBefore.body.result.status).toBe("disabled");

			const update = await post<{
				success: boolean;
				result: { id: string; nickname: string; status: string };
			}>("/order-users/update", {
				id: user.id,
				nickname: "after update",
				status: "enabled",
			});
			expect(update.response.status).toBe(200);
			expect(update.body.result).toEqual(
				expect.objectContaining({
					id: user.id,
					nickname: "after update",
					status: "enabled",
				}),
			);

			const deleted = await post<{
				success: boolean;
				result: { id: string; is_delete: number };
			}>("/order-users/delete", { id: user.id });
			expect(deleted.response.status).toBe(200);
			expect(deleted.body.result).toEqual(
				expect.objectContaining({ id: user.id, is_delete: 1 }),
			);

			const readAfter = await post("/order-users/read", { id: user.id });
			expect(readAfter.response.status).toBe(404);

			const listAfter = await post<{
				success: boolean;
				result: Array<{ id: string }>;
			}>("/order-users/list");
			expect(listAfter.body.result).not.toEqual(
				expect.arrayContaining([expect.objectContaining({ id: user.id })]),
			);
		});

		it("rejects invalid user status", async () => {
			const { response, body } = await post<{
				success: boolean;
				errors: Array<{ message: string }>;
			}>("/order-users/create", {
				nickname: "bad status",
				token: "token-002",
				status: "paused",
			});

			expect(response.status).toBe(400);
			expect(body.success).toBe(false);
			expect(body.errors).toBeInstanceOf(Array);
		});
	});

	describe("POST /sellable-products/*", () => {
		it("creates a sellable product with arrays, generated id, and defaults", async () => {
			const user = await createOrderUser();

			const { response, body } = await post<{
				success: boolean;
				result: {
					id: string;
					sellable_product_ids: string[];
					sellable_sku_codes: string[];
					sellable_quantity: number;
					status: string;
					order_user_id: string;
					third_party_remark_id: string;
					third_party_order_id: string;
					third_party_product_id: string;
					is_delete: number;
				};
			}>("/sellable-products/create", {
				sellable_product_ids: ["prod-001", "prod-002"],
				sellable_sku_codes: ["sku-001", "sku-002"],
				order_user_id: user.id,
				third_party_remark_id: "A9z",
				third_party_order_id: "third-order-001",
				third_party_product_id: "third-product-001",
			});

			expect(response.status).toBe(201);
			expect(body.success).toBe(true);
			expect(body.result).toEqual({
				id: expect.stringMatching(idPattern),
				sellable_product_ids: ["prod-001", "prod-002"],
				sellable_sku_codes: ["sku-001", "sku-002"],
				sellable_quantity: 1,
				status: "waiting",
				order_user_id: user.id,
				third_party_remark_id: "A9z",
				third_party_order_id: "third-order-001",
				third_party_product_id: "third-product-001",
				is_delete: 0,
			});
		});

		it("lists, reads, updates, and soft deletes sellable products through POST bodies", async () => {
			const user = await createOrderUser();
			const create = await post<{
				success: boolean;
				result: { id: string };
			}>("/sellable-products/create", {
				sellable_product_ids: ["prod-003"],
				sellable_sku_codes: ["sku-003"],
				sellable_quantity: 2,
				order_user_id: user.id,
				third_party_remark_id: "b2C",
			});
			expect(create.response.status).toBe(201);

			const id = create.body.result.id;
			const listBefore = await post<{
				success: boolean;
				result: Array<{ id: string; sellable_quantity: number }>;
			}>("/sellable-products/list");
			expect(listBefore.response.status).toBe(200);
			expect(listBefore.body.result).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id, sellable_quantity: 2 }),
				]),
			);

			const readBefore = await post<{
				success: boolean;
				result: { id: string; sellable_product_ids: string[] };
			}>("/sellable-products/read", { id });
			expect(readBefore.response.status).toBe(200);
			expect(readBefore.body.result.sellable_product_ids).toEqual(["prod-003"]);

			const update = await post<{
				success: boolean;
				result: {
					id: string;
					sellable_product_ids: string[];
					sellable_sku_codes: string[];
					sellable_quantity: number;
					status: string;
					third_party_order_id: string;
				};
			}>("/sellable-products/update", {
				id,
				sellable_product_ids: ["prod-004", "prod-005"],
				sellable_sku_codes: ["sku-004", "sku-005"],
				sellable_quantity: 4,
				status: "pending",
				third_party_order_id: "third-order-002",
			});
			expect(update.response.status).toBe(200);
			expect(update.body.result).toEqual(
				expect.objectContaining({
					id,
					sellable_product_ids: ["prod-004", "prod-005"],
					sellable_sku_codes: ["sku-004", "sku-005"],
					sellable_quantity: 4,
					status: "pending",
					third_party_order_id: "third-order-002",
				}),
			);

			const deleted = await post<{
				success: boolean;
				result: { id: string; is_delete: number };
			}>("/sellable-products/delete", { id });
			expect(deleted.response.status).toBe(200);
			expect(deleted.body.result).toEqual(
				expect.objectContaining({ id, is_delete: 1 }),
			);

			const readAfter = await post("/sellable-products/read", { id });
			expect(readAfter.response.status).toBe(404);
		});

		it("rejects invalid third_party_remark_id", async () => {
			const user = await createOrderUser();

			const { response, body } = await post<{
				success: boolean;
				errors: Array<{ message: string }>;
			}>("/sellable-products/create", {
				sellable_product_ids: ["prod-006"],
				sellable_sku_codes: ["sku-006"],
				order_user_id: user.id,
				third_party_remark_id: "too-long",
			});

			expect(response.status).toBe(400);
			expect(body.success).toBe(false);
			expect(body.errors).toBeInstanceOf(Array);
		});

		it("rejects unknown order_user_id", async () => {
			const { response, body } = await post<{
				success: boolean;
				errors: Array<{ message: string }>;
			}>("/sellable-products/create", {
				sellable_product_ids: ["prod-007"],
				sellable_sku_codes: ["sku-007"],
				order_user_id: "AbC123xYz9",
			});

			expect(response.status).toBe(400);
			expect(body.success).toBe(false);
			expect(body.errors[0].message).toContain("order_user_id");
		});
	});

	describe("POST /xy/order/xiadan", () => {
		it("marks a sellable product order as pending by orderId", async () => {
			const user = await createOrderUser();
			const create = await post<{
				success: boolean;
				result: { id: string; status: string };
			}>("/sellable-products/create", {
				sellable_product_ids: ["prod-xy-001"],
				sellable_sku_codes: ["sku-xy-001"],
				order_user_id: user.id,
				third_party_remark_id: "X1y",
				third_party_order_id: "xy-order-001",
				third_party_product_id: "xy-product-001",
			});
			expect(create.response.status).toBe(201);
			expect(create.body.result.status).toBe("waiting");

			const xiadan = await post<{
				code?: number;
				success?: boolean;
				result: { id: string; status: string };
			}>("/xy/order/xiadan", { orderId: "xy-order-001" });
			expect(xiadan.response.status).toBe(200);
			expect(xiadan.body.result).toEqual(
				expect.objectContaining({
					id: create.body.result.id,
					status: "pending",
				}),
			);

			const readAfter = await post<{
				success: boolean;
				result: { id: string; status: string };
			}>("/sellable-products/read", { id: create.body.result.id });
			expect(readAfter.response.status).toBe(200);
			expect(readAfter.body.result.status).toBe("pending");
		});
	});

	describe("POST /order/queryShopList", () => {
		it("forwards queryShopList with the token from the sellable product order user", async () => {
			const user = await createOrderUser({ token: "luckin-user-token" });
			const create = await post<{
				success: boolean;
				result: { id: string };
			}>("/sellable-products/create", {
				sellable_product_ids: ["prod-shop-001"],
				sellable_sku_codes: ["sku-shop-001"],
				order_user_id: user.id,
			});
			expect(create.response.status).toBe(201);

			const calls: Request[] = [];
			const fetcher: typeof fetch = async (input, init) => {
				const request = new Request(input, init);
				calls.push(request.clone());
				expect(request.url).toBe("https://gwmcp.lkcoffee.com/order/user/mcp");
				expect(request.method).toBe("POST");
				expect(request.headers.get("authorization")).toBe(
					"Bearer luckin-user-token",
				);
				expect(request.headers.get("accept")).toBe(
					"application/json, text/event-stream",
				);
				expect(request.headers.get("content-type")).toBe("application/json");
				expect(await request.json()).toEqual({
					jsonrpc: "2.0",
					id: "queryShopList",
					method: "tools/call",
					params: {
						name: "queryShopList",
						arguments: {
							deptName: "海西金谷",
							longitude: 118.08891,
							latitude: 24.479627,
						},
					},
				});

				return Response.json({
					jsonrpc: "2.0",
					id: "queryShopList",
					result: {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									code: 0,
									msg: "success",
									success: true,
									data: [
										{
											deptId: 245062453,
											deptName: "AI点单专用",
											address: "北京安贞环宇荟",
											deptTags: [],
											longitude: 116.392435,
											latitude: 39.982376,
											workTimeStart: "00:00",
											workTimeEnd: "24:00",
											distance: 8.2038,
											number: "(No.100070)",
										},
									],
								}),
							},
						],
					},
				});
			};

			const result = await queryShopListForSellableProduct(env.DB, fetcher, {
				id: create.body.result.id,
				sign: "AbC123xYz9",
				deptName: "海西金谷",
				longitude: 118.08891,
				latitude: 24.479627,
			});

			expect(calls).toHaveLength(1);
			expect(result).toEqual([
				expect.objectContaining({
					deptId: 245062453,
					deptName: "AI点单专用",
				}),
			]);
		});

		it("maps non-JSON Luckin MCP failures to a 502 forwarding error", async () => {
			const user = await createOrderUser({ token: "luckin-user-token" });
			const create = await post<{
				success: boolean;
				result: { id: string };
			}>("/sellable-products/create", {
				sellable_product_ids: ["prod-shop-002"],
				sellable_sku_codes: ["sku-shop-002"],
				order_user_id: user.id,
			});
			expect(create.response.status).toBe(201);

			const fetcher: typeof fetch = async () =>
				new Response("bad gateway", { status: 503 });

			await expect(
				queryShopListForSellableProduct(env.DB, fetcher, {
					id: create.body.result.id,
					sign: "AbC123xYz9",
					deptName: "海西金谷",
					longitude: 118.08891,
					latitude: 24.479627,
				}),
			).rejects.toMatchObject<QueryShopListError>({
				message: "Luckin MCP request failed",
				status: 502,
			});
		});
	});

	describe("POST /order/* Luckin MCP tool forwards", () => {
		it.each([
			[
				"searchProductForMcp",
				{
					deptId: 245062453,
					query: "拿铁",
				},
				[{ productId: 11447, productName: "耶加雪菲拿铁" }],
			],
			[
				"switchProduct",
				{
					deptId: 245062453,
					productId: 17443,
					skuCode: "SP11795-00006",
					attrOperationParam: {
						attributeId: 122,
						subAttr: {
							attributeId: 428,
							operation: 3,
						},
					},
					amount: 1,
				},
				{ productId: 17443, skuCode: "SP11795-00006" },
			],
			[
				"queryProductDetailInfo",
				{
					deptId: 245062453,
					productId: 17443,
				},
				{ productId: 17443, productName: "冬至五养拿铁" },
			],
			[
				"previewOrder",
				{
					deptId: 245062453,
					productList: [
						{
							amount: 1,
							productId: 11447,
							skuCode: "SP9636-00001",
						},
					],
				},
				{ discountPrice: 16, couponCodeList: [] },
			],
			[
				"createOrder",
				{
					deptId: 245062453,
					productList: [
						{
							amount: 1,
							productId: 11447,
							skuCode: "SP9636-00001",
						},
					],
					longitude: 118.08891,
					latitude: 24.479627,
					couponCodeList: ["coupon-001"],
					remark: "少冰",
				},
				{
					orderId: 7639308439653908000,
					orderIdStr: "7639308439653908490",
				},
			],
			[
				"queryOrderDetailInfo",
				{
					orderId: "7639308439653908490",
				},
				{
					orderId: "7639308439653908490",
					orderStatusName: "待付款",
				},
			],
			[
				"cancelOrder",
				{
					orderId: "7639308439653908490",
				},
				true,
			],
		])("forwards %s with id/sign gated token lookup", async (toolName, args, responseData) => {
			const user = await createOrderUser({ token: `${toolName}-token` });
			const create = await post<{
				success: boolean;
				result: { id: string };
			}>("/sellable-products/create", {
				sellable_product_ids: [`prod-${toolName}`],
				sellable_sku_codes: [`sku-${toolName}`],
				order_user_id: user.id,
			});
			expect(create.response.status).toBe(201);

			const fetcher: typeof fetch = async (input, init) => {
				const request = new Request(input, init);
				expect(request.url).toBe("https://gwmcp.lkcoffee.com/order/user/mcp");
				expect(request.headers.get("authorization")).toBe(
					`Bearer ${toolName}-token`,
				);
				expect(await request.json()).toEqual({
					jsonrpc: "2.0",
					id: toolName,
					method: "tools/call",
					params: {
						name: toolName,
						arguments: args,
					},
				});

				return Response.json({
					jsonrpc: "2.0",
					id: toolName,
					result: {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									code: 0,
									msg: "success",
									success: true,
									data: responseData,
								}),
							},
						],
					},
				});
			};

			await expect(
				forwardLuckinMcpToolForSellableProduct(env.DB, fetcher, {
					id: create.body.result.id,
					sign: "AbC123xYz9",
					toolName,
					arguments: args,
				}),
			).resolves.toEqual(responseData);
		});

		it.each([
			["searchProductForMcp", { deptId: 245062453, query: "拿铁" }],
			[
				"switchProduct",
				{
					deptId: 245062453,
					productId: 17443,
					skuCode: "SP11795-00006",
					attrOperationParam: {
						attributeId: 122,
						subAttr: { attributeId: 428, operation: 3 },
					},
					amount: 1,
				},
			],
			[
				"queryProductDetailInfo",
				{ deptId: 245062453, productId: 17443 },
			],
			[
				"previewOrder",
				{
					deptId: 245062453,
					productList: [
						{ amount: 1, productId: 11447, skuCode: "SP9636-00001" },
					],
				},
			],
			[
				"createOrder",
				{
					deptId: 245062453,
					productList: [
						{ amount: 1, productId: 11447, skuCode: "SP9636-00001" },
					],
					longitude: 118.08891,
					latitude: 24.479627,
				},
			],
			["queryOrderDetailInfo", { orderId: "7639308439653908490" }],
			["cancelOrder", { orderId: "7639308439653908490" }],
		])("requires id and sign for %s", async (toolName, args) => {
			const missingId = await post(`/order/${toolName}`, {
				...args,
				sign: "AbC123xYz9",
			});
			expect(missingId.response.status).toBe(400);

			const missingSign = await post(`/order/${toolName}`, {
				id: "AbC123xYz9",
				...args,
			});
			expect(missingSign.response.status).toBe(400);
		});
	});
});

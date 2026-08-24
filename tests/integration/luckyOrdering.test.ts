import { env, SELF } from "cloudflare:test";
import CryptoJS from "crypto-js";
import { describe, expect, it } from "vitest";
import {
	QueryShopListError,
	queryShopListForSellableProduct,
} from "../../src/controller/order/queryShopList";
import { forwardLuckinMcpToolForSellableProduct } from "../../src/controller/order/luckinMcp";
import { miniprogramCreateOrderForSellableProduct } from "../../src/controller/order/miniprogramCreateOrder";
import {
	listLuckinProducts,
	upsertLuckinProducts,
} from "../../src/models/luckyProducts";
import { syncLuckinCatalogForSellableProduct } from "../../src/controller/order/catalog";

const idPattern = /^[a-zA-Z0-9]{10}$/;
const miniprogramAesKey = "CJQjAc1hYieC4QYb";
const miniprogramUid =
	"f931e729-4279-4d30-bdc5-0254af362e551787569733931-2926637-efAmj7k25Su8lEAGHeSrLLDaF7WCSl67RQEGsHnOQYYh3CdepZU4TszMDkSxpjkO";

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

function encryptedMiniprogramResponse(payload: Record<string, unknown>) {
	return new Response(encryptMiniprogramPayload(payload), {
		headers: { "Content-Type": "text/plain;charset=UTF-8" },
	});
}

function encryptMiniprogramPayload(payload: Record<string, unknown>) {
	return CryptoJS.AES.encrypt(
		JSON.stringify(payload),
		CryptoJS.enc.Utf8.parse(miniprogramAesKey),
		{
			mode: CryptoJS.mode.ECB,
			padding: CryptoJS.pad.Pkcs7,
		},
	)
		.toString()
		.replace(/\+/g, "-")
		.replace(/\//g, "_");
}

function decryptMiniprogramPayload(q: string) {
	const decrypted = CryptoJS.AES.decrypt(
		q.replace(/-/g, "+").replace(/_/g, "/"),
		CryptoJS.enc.Utf8.parse(miniprogramAesKey),
		{
			mode: CryptoJS.mode.ECB,
			padding: CryptoJS.pad.Pkcs7,
		},
	).toString(CryptoJS.enc.Utf8);

	return JSON.parse(decrypted) as Record<string, unknown>;
}

function signMiniprogramParams(params: Record<string, string>, uid: string) {
	const plain = Object.entries({ ...params, uid })
		.filter(([key]) => key !== "sign")
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${value}`)
		.join(";");

	return CryptoJS.MD5(`${plain}${miniprogramAesKey}`).words
		.map((word) => Math.abs(word).toString())
		.join("");
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
				status: "done",
				third_party_order_id: "third-order-002",
			});
			expect(update.response.status).toBe(200);
			expect(update.body.result).toEqual(
				expect.objectContaining({
					id,
					sellable_product_ids: ["prod-004", "prod-005"],
					sellable_sku_codes: ["sku-004", "sku-005"],
					sellable_quantity: 4,
					status: "done",
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

	describe("POST /order/miniprogramcreateOrder", () => {
		it("previews with default coffee card selection before creating a zero-pay miniprogram order", async () => {
			const user = await createOrderUser({
				token: JSON.stringify({
					uid: miniprogramUid,
					openid: "openid-legacy-flow",
				}),
			});
			const create = await post<{
				success: boolean;
				result: { id: string };
			}>("/sellable-products/create", {
				sellable_product_ids: ["11447"],
				sellable_sku_codes: ["SP9636-00001"],
				order_user_id: user.id,
			});
			expect(create.response.status).toBe(201);

			const calls: Array<{
				url: string;
				body: Record<string, unknown>;
				payload: Record<string, unknown>;
			}> = [];
			const fetcher: typeof fetch = async (input, init) => {
				const request = new Request(input, init);
				expect(request.headers.get("cookie")).toBe(`uid=${miniprogramUid}`);
				expect(request.headers.get("accept")).toBe("*/*");
				expect(request.headers.get("content-type")).toBe(
					"application/x-www-form-urlencoded",
				);
				expect(request.headers.get("x-lk-akv")).toBe("lk-wxmp-v5.3.22");
				expect(request.headers.get("x-lk-mid")).toBe("2926637");
				expect(request.headers.get("accept-language")).toBe("zh-CN,zh;q=0.9");
				expect(request.headers.get("sec-fetch-site")).toBe("cross-site");
				const rawBody = new TextDecoder().decode(await request.arrayBuffer());
				const params = new URLSearchParams(rawBody);
				const body = Object.fromEntries(params.entries());
				expect(body).toEqual(
					expect.objectContaining({
						cid: "230101",
						dk: "1",
						q: expect.stringMatching(/^[A-Za-z0-9_-]+={0,2}$/),
						sign: expect.stringMatching(/^\d+$/),
					}),
				);
				expect(body).not.toHaveProperty("uid");
				expect(body.q).not.toContain("productId");
				expect(body.sign).toBe(
					signMiniprogramParams(
						{
							cid: String(body.cid),
							dk: String(body.dk),
							q: String(body.q),
						},
						miniprogramUid,
					),
				);
				const payload = decryptMiniprogramPayload(String(body.q));
				expect(payload).not.toHaveProperty("uid");
				calls.push({ url: request.url, body, payload });

				if (request.url.endsWith("/resource/core/v2/order/preview")) {
					expect(payload.miniversion).toBe("5587");
					expect(request.headers.get("x-lk-sid")).toBe("245062453");
					expect(payload).toEqual(
						expect.objectContaining({
							shopAbTest: true,
							cityId: 2,
							deptId: 245062453,
							couponCodeList: [],
							isFirst: 1,
							recommendDispatchCoupon: 1,
							recommendCard: 1,
							recommendLimitCoupon: 1,
							useDiscountType: 2,
							limitDiscountInfo: null,
							productList: [
								expect.objectContaining({
									amount: 1,
									checked: 1,
									eatway: "both",
									productId: 11447,
									skuCode: "SP9636-00001",
									processTypeDetailList: [],
									cafeKuId: "",
								}),
							],
						}),
					);
					expect(
						(payload.productList as Array<Record<string, unknown>>)[0],
					).not.toHaveProperty("couponNo");
					return encryptedMiniprogramResponse({
						code: 1,
						msg: "success",
						content: {
							discountPrice: 0,
							couponCodeList: [],
							productDetailList: [
								{
									indexId: 1,
									productId: 11447,
									skuCode: "SP9636-00001",
									amount: 1,
									cafeKuId: "card-001",
									couponNo: "coupon-card-001",
									coffeeVoucherType: 1,
									processTypeDetailList: [],
									supportChangeProcessType: 0,
								},
							],
						},
					});
				}

				expect(request.url).toMatch(/\/resource\/core\/v1\/order\/create$/);
				expect(payload.productList).toEqual([
					expect.objectContaining({
						productId: 11447,
						skuCode: "SP9636-00001",
						cafeKuId: "card-001",
						couponNo: "coupon-card-001",
						coffeeVoucherType: 1,
					}),
				]);
				return encryptedMiniprogramResponse({
					code: 1,
					msg: "success",
					content: {
						orderIdStr: "7639308439653908490",
					},
				});
			};

			await expect(
				miniprogramCreateOrderForSellableProduct(env.DB, fetcher, {
					id: create.body.result.id,
					sign: "AbC123xYz9",
					deptId: 245062453,
					longitude: 118.08891,
					latitude: 24.479627,
					couponCodeList: ["SHOULD_NOT_FORWARD_FOR_CARD_FLOW"],
					productList: [
						{
							amount: 1,
							productId: 11447,
							skuCode: "SP9636-00001",
						},
					],
					remark: "少冰",
				}),
			).resolves.toEqual({
				preview: expect.objectContaining({ discountPrice: 0 }),
				order: { orderIdStr: "7639308439653908490" },
			});

			expect(calls).toHaveLength(2);
			expect(calls[0]).toEqual({
				url: "https://capi.lkcoffee.com/resource/core/v2/order/preview",
				body: expect.objectContaining({
						cid: "230101",
						dk: "1",
					}),
					payload: expect.objectContaining({
						couponCodeList: [],
						miniversion: "5587",
					}),
				});
			expect(calls[0].payload).not.toHaveProperty("uid");
			expect(calls[1]).toEqual({
				url: "https://capi.lkcoffee.com/resource/core/v1/order/create",
				body: expect.objectContaining({
					cid: "230101",
					dk: "1",
					}),
					payload: expect.objectContaining({
						couponCodeList: [],
						appVersion: 101,
						dispatchDistance: "",
						giftProductList: [],
						joinPlan: [],
						miniversion: "5587",
						payCardSceneType: 1,
						submit: 0,
						submitOf600: 0,
					}),
				});
			expect(calls[1].payload).not.toHaveProperty("uid");
		});

		it("uses coffee card details from preview priceList when creating the order", async () => {
			const user = await createOrderUser({
				token: JSON.stringify({
					uid: miniprogramUid,
					openid: "openid-price-list",
				}),
			});
			const create = await post<{
				success: boolean;
				result: { id: string };
			}>("/sellable-products/create", {
				sellable_product_ids: ["5151"],
				sellable_sku_codes: ["SP3571-00244"],
				order_user_id: user.id,
			});
			expect(create.response.status).toBe(201);

			let createPayload: Record<string, unknown> | undefined;
			const fetcher: typeof fetch = async (input, init) => {
				const request = new Request(input, init);
				const rawBody = new TextDecoder().decode(await request.arrayBuffer());
				const params = new URLSearchParams(rawBody);
				const payload = decryptMiniprogramPayload(String(params.get("q")));

				if (request.url.endsWith("/resource/core/v2/order/preview")) {
					return encryptedMiniprogramResponse({
						code: 1,
						msg: "success",
						content: {
							discountPrice: 0,
							couponCodeList: [],
							priceList: [
								{
									indexId: 1,
									productId: 5151,
									skuCode: "SP3571-00244",
									amount: 1,
									cafeKuId: "7671267849822863369",
									couponNo: "",
									coffeeVoucherType: 1,
									processTypeDetailList: [],
									supportChangeProcessType: 0,
								},
							],
						},
					});
				}

				createPayload = payload;
				return encryptedMiniprogramResponse({
					code: 1,
					msg: "success",
					content: {
						orderIdStr: "7639308439653908490",
						forwardPage: "detail",
					},
				});
			};

			await miniprogramCreateOrderForSellableProduct(env.DB, fetcher, {
				id: create.body.result.id,
				sign: "AbC123xYz9",
				deptId: 613299,
				longitude: 121.36506825616252,
				latitude: 31.17089985836377,
				productList: [
					{
						amount: 1,
						productId: 5151,
						skuCode: "SP3571-00244",
					},
				],
			});

			expect(createPayload?.productList).toEqual([
				expect.objectContaining({
					indexId: 1,
					productId: 5151,
					skuCode: "SP3571-00244",
					amount: 1,
					cafeKuId: "7671267849822863369",
					couponNo: "",
					coffeeVoucherType: 1,
					processTypeDetailList: [],
					supportChangeProcessType: 0,
				}),
			]);
		});

		it("continues with topay when create returns pay and completes a zero-pay order", async () => {
			const user = await createOrderUser({
				token: JSON.stringify({
					uid: miniprogramUid,
					openid: "openid-001",
					blackBox: "blackbox-001",
					notifyCode: "notify-code-001",
					csid: "csid-001",
				}),
			});
			const create = await post<{
				success: boolean;
				result: { id: string };
			}>("/sellable-products/create", {
				sellable_product_ids: ["5151"],
				sellable_sku_codes: ["SP3571-00244"],
				order_user_id: user.id,
			});
			expect(create.response.status).toBe(201);

			const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];
			const fetcher: typeof fetch = async (input, init) => {
				const request = new Request(input, init);
				const rawBody = new TextDecoder().decode(await request.arrayBuffer());
				const params = new URLSearchParams(rawBody);
				const payload = decryptMiniprogramPayload(String(params.get("q")));
				calls.push({ url: request.url, payload });

				if (request.url.endsWith("/resource/core/v2/order/preview")) {
					return encryptedMiniprogramResponse({
						code: 1,
						msg: "success",
						content: {
							discountPrice: 0,
							priceList: [
								{
									indexId: 1,
									productId: 5151,
									skuCode: "SP3571-00244",
									amount: 1,
									cafeKuId: "card-001",
									couponNo: "",
									coffeeVoucherType: 1,
								},
							],
						},
					});
				}

				if (request.url.endsWith("/resource/core/v1/order/create")) {
					return encryptedMiniprogramResponse({
						code: 1,
						msg: "success",
						content: {
							orderId: "7639308439653908490",
							orderChild: "2",
							forwardPage: "pay",
						},
					});
				}

				expect(request.url).toMatch(/\/resource\/core\/v2\/pay\/topay$/);
				expect(request.headers.get("x-lk-sid")).toBe("613299");
				expect(request.headers.get("x-lk-csid")).toBe("csid-001");
				expect(payload).toEqual(
					expect.objectContaining({
						blackBox: "blackbox-001",
						longitude: 121.36506825616252,
						latitude: 31.17089985836377,
						payType: "7",
						busType: 0,
						openid: "openid-001",
						notifyCode: "notify-code-001",
						orderId: "7639308439653908490",
						miniversion: "5587",
					}),
				);
				expect(payload).not.toHaveProperty("deptId");

				return encryptedMiniprogramResponse({
					code: 1,
					msg: "success",
					content: {
						payStatus: 1,
						needPay: false,
						desc: "SUCCESS",
					},
				});
			};

			await expect(
				miniprogramCreateOrderForSellableProduct(env.DB, fetcher, {
					id: create.body.result.id,
					sign: "AbC123xYz9",
					deptId: 613299,
					longitude: 121.36506825616252,
					latitude: 31.17089985836377,
					productList: [
						{
							amount: 1,
							productId: 5151,
							skuCode: "SP3571-00244",
						},
					],
				}),
			).resolves.toEqual({
				preview: expect.objectContaining({ discountPrice: 0 }),
				order: expect.objectContaining({
					orderId: "7639308439653908490",
					forwardPage: "pay",
				}),
				pay: expect.objectContaining({
					needPay: false,
					payStatus: 1,
				}),
			});
			expect(calls.map((call) => call.url)).toEqual([
				"https://capi.lkcoffee.com/resource/core/v2/order/preview",
				"https://capi.lkcoffee.com/resource/core/v1/order/create",
				"https://capi.lkcoffee.com/resource/core/v2/pay/topay",
			]);
		});

		it("does not mark the miniprogram order complete when topay still needs payment", async () => {
			const user = await createOrderUser({
				token: JSON.stringify({
					uid: miniprogramUid,
					openid: "openid-002",
				}),
			});
			const create = await post<{
				success: boolean;
				result: { id: string };
			}>("/sellable-products/create", {
				sellable_product_ids: ["5151"],
				sellable_sku_codes: ["SP3571-00244"],
				order_user_id: user.id,
			});
			expect(create.response.status).toBe(201);

			const fetcher: typeof fetch = async (input, init) => {
				const request = new Request(input, init);

				if (request.url.endsWith("/resource/core/v2/order/preview")) {
					return encryptedMiniprogramResponse({
						code: 1,
						msg: "success",
						content: {
							discountPrice: 0,
							priceList: [
								{
									indexId: 1,
									productId: 5151,
									skuCode: "SP3571-00244",
									amount: 1,
									cafeKuId: "card-001",
									coffeeVoucherType: 1,
								},
							],
						},
					});
				}

				if (request.url.endsWith("/resource/core/v1/order/create")) {
					return encryptedMiniprogramResponse({
						code: 1,
						msg: "success",
						content: {
							orderId: "7639308439653908491",
							forwardPage: "pay",
						},
					});
				}

				return encryptedMiniprogramResponse({
					code: 1,
					msg: "success",
					content: {
						payStatus: 1,
						needPay: true,
						payParams: { nonceStr: "nonce" },
					},
				});
			};

			await expect(
				miniprogramCreateOrderForSellableProduct(env.DB, fetcher, {
					id: create.body.result.id,
					sign: "AbC123xYz9",
					deptId: 613299,
					longitude: 121.36506825616252,
					latitude: 31.17089985836377,
					productList: [
						{
							amount: 1,
							productId: 5151,
							skuCode: "SP3571-00244",
						},
					],
				}),
			).rejects.toMatchObject({
				message: "Luckin miniprogram order still requires payment",
				status: 409,
			});
		});

		it("uses captured miniprogram pay defaults for a legacy token", async () => {
			const user = await createOrderUser({
				token: "legacy-mcp-token",
			});
			const create = await post<{
				success: boolean;
				result: { id: string };
			}>("/sellable-products/create", {
				sellable_product_ids: ["5151"],
				sellable_sku_codes: ["SP3571-00244"],
				order_user_id: user.id,
			});
			expect(create.response.status).toBe(201);

			const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];
			const fetcher: typeof fetch = async (input, init) => {
				const request = new Request(input, init);
				const rawBody = new TextDecoder().decode(await request.arrayBuffer());
				const params = new URLSearchParams(rawBody);
				const payload = decryptMiniprogramPayload(String(params.get("q")));
				calls.push({ url: request.url, payload });

				if (request.url.endsWith("/resource/core/v2/order/preview")) {
					return encryptedMiniprogramResponse({
						code: 1,
						msg: "success",
						content: {
							discountPrice: 0,
							priceList: [
								{
									indexId: 1,
									productId: 5151,
									skuCode: "SP3571-00244",
									amount: 1,
									cafeKuId: "card-001",
									coffeeVoucherType: 1,
								},
							],
						},
					});
				}

				if (request.url.endsWith("/resource/core/v1/order/create")) {
					return encryptedMiniprogramResponse({
						code: 1,
						msg: "success",
						content: {
							orderId: "7639308439653908492",
							forwardPage: "pay",
						},
					});
				}

				return encryptedMiniprogramResponse({
					code: 1,
					msg: "success",
					content: {
						payStatus: 0,
						needPay: false,
					},
				});
			};

			await expect(
				miniprogramCreateOrderForSellableProduct(env.DB, fetcher, {
					id: create.body.result.id,
					sign: "AbC123xYz9",
					deptId: 613299,
					longitude: 121.36506825616252,
					latitude: 31.17089985836377,
					productList: [
						{
							amount: 1,
							productId: 5151,
							skuCode: "SP3571-00244",
						},
						],
					}),
			).resolves.toEqual({
				preview: expect.objectContaining({ discountPrice: 0 }),
				order: expect.objectContaining({
					orderId: "7639308439653908492",
					forwardPage: "pay",
				}),
				pay: expect.objectContaining({
					needPay: false,
					payStatus: 0,
				}),
			});
			expect(calls.map((call) => call.url)).toEqual([
				"https://capi.lkcoffee.com/resource/core/v2/order/preview",
				"https://capi.lkcoffee.com/resource/core/v1/order/create",
				"https://capi.lkcoffee.com/resource/core/v2/pay/topay",
			]);
			expect(calls[2].payload).toEqual(
				expect.objectContaining({
					blackBox: "jMPHN1787540409vyeJR3fMRi7",
					openid: "ovKu05ATRnvyp7wnI1Sew-MP2U5I",
					payType: "7",
					notifyCode: "c1.x4g9FHsA0q9qpK_2cw9j_IqsLMDHSHbvkZoZ0UntOnw",
					miniversion: "5587",
				}),
			);
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

	describe("Luckin product catalog", () => {
		it("upserts real Luckin catalog products and lists deserialized rows", async () => {
			await upsertLuckinProducts(
				env.DB,
				[
					{
						productId: 11447,
						productName: "耶加雪菲拿铁",
						skuCode: "SP9636-00001",
						pictureUrl: "https://img.example/latte.png",
						initialPrice: 16,
						estimatePrice: 15,
						tags: ["拿铁"],
						productAttrs: [{ attributeId: 1, attributeName: "温度" }],
					},
					{
						productId: 22558,
						productName: "标准美式",
						skuCode: "SP22558-00001",
						tags: ["美式"],
					},
				],
				"拿铁",
			);

			await upsertLuckinProducts(
				env.DB,
				[
					{
						productId: 11447,
						productName: "耶加雪菲拿铁",
						skuCode: "SP9636-00001",
						pictureUrl: "https://img.example/latte-new.png",
						initialPrice: 18,
						estimatePrice: 16,
						tags: ["拿铁", "热卖"],
					},
				],
				"拿铁",
			);

			const products = await listLuckinProducts(env.DB);

			expect(products).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						productId: 11447,
						productName: "耶加雪菲拿铁",
						skuCode: "SP9636-00001",
						pictureUrl: "https://img.example/latte-new.png",
						initialPrice: 18,
						estimatePrice: 16,
						tags: ["拿铁", "热卖"],
						sourceQuery: "拿铁",
					}),
					expect.objectContaining({
						productId: 22558,
						productName: "标准美式",
						skuCode: "SP22558-00001",
						tags: ["美式"],
					}),
				]),
			);
			expect(
				products.filter(
					(product) =>
						product.productId === 11447 && product.skuCode === "SP9636-00001",
				),
			).toHaveLength(1);
		});

		it("returns local catalog products through id and sign gated list endpoint", async () => {
			const user = await createOrderUser({ token: "catalog-list-token" });
			const create = await post<{
				success: boolean;
				result: { id: string };
			}>("/sellable-products/create", {
				sellable_product_ids: ["test-product"],
				sellable_sku_codes: ["test-sku"],
				order_user_id: user.id,
			});
			expect(create.response.status).toBe(201);

			await upsertLuckinProducts(
				env.DB,
				[
					{
						productId: 33110,
						productName: "生椰拿铁",
						skuCode: "SP33110-00001",
						estimatePrice: 19,
					},
				],
				"拿铁",
			);

			const list = await post<{
				code: number;
				result: Array<{ productId: number; productName: string; skuCode: string }>;
			}>("/order/catalog/list", {
				id: create.body.result.id,
				sign: "AbC123xYz9",
			});

			expect(list.response.status).toBe(200);
			expect(list.body.result).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						productId: 33110,
						productName: "生椰拿铁",
						skuCode: "SP33110-00001",
					}),
				]),
			);
		});

		it("syncs 美式 and 拿铁 products through mocked Luckin MCP and persists them", async () => {
			const user = await createOrderUser({ token: "catalog-sync-token" });
			const create = await post<{
				success: boolean;
				result: { id: string };
			}>("/sellable-products/create", {
				sellable_product_ids: ["test-product"],
				sellable_sku_codes: ["test-sku"],
				order_user_id: user.id,
			});
			expect(create.response.status).toBe(201);

			const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
			const fetcher: typeof fetch = async (input, init) => {
				const request = new Request(input, init);
				expect(request.headers.get("authorization")).toBe(
					"Bearer catalog-sync-token",
				);
				const body = (await request.json()) as {
					params: { name: string; arguments: Record<string, unknown> };
				};
				calls.push(body.params);
				const query = body.params.arguments.query;

				return Response.json({
					jsonrpc: "2.0",
					id: "searchProductForMcp",
					result: {
						content: [
							{
								type: "text",
								text: JSON.stringify({
									data:
										query === "美式"
											? [
													{
														productId: 22558,
														productName: "标准美式",
														skuCode: "SP22558-00001",
														tags: ["美式"],
													},
												]
											: [
													{
														productId: 33110,
														productName: "生椰拿铁",
														skuCode: "SP33110-00001",
														tags: ["拿铁"],
													},
												],
								}),
							},
						],
					},
				});
			};

			const synced = await syncLuckinCatalogForSellableProduct(env.DB, fetcher, {
				id: create.body.result.id,
				sign: "AbC123xYz9",
				deptId: 245062453,
				queries: ["美式", "拿铁"],
			});

			expect(calls).toEqual([
				{
					name: "searchProductForMcp",
					arguments: { deptId: 245062453, query: "美式" },
				},
				{
					name: "searchProductForMcp",
					arguments: { deptId: 245062453, query: "拿铁" },
				},
			]);
			expect(synced).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ productId: 22558, skuCode: "SP22558-00001" }),
					expect.objectContaining({ productId: 33110, skuCode: "SP33110-00001" }),
				]),
			);
			await expect(listLuckinProducts(env.DB)).resolves.toEqual(
				expect.arrayContaining([
					expect.objectContaining({ productId: 22558, skuCode: "SP22558-00001" }),
					expect.objectContaining({ productId: 33110, skuCode: "SP33110-00001" }),
				]),
			);
		});

		it("repairs a sellable product row with real catalog product ids and sku codes", async () => {
			const user = await createOrderUser({ token: "catalog-repair-token" });
			const create = await post<{
				success: boolean;
				result: { id: string };
			}>("/sellable-products/create", {
				sellable_product_ids: ["test-product"],
				sellable_sku_codes: ["test-sku"],
				sellable_quantity: 2,
				order_user_id: user.id,
			});
			expect(create.response.status).toBe(201);

			await upsertLuckinProducts(
				env.DB,
				[
					{
						productId: 22558,
						productName: "标准美式",
						skuCode: "SP22558-00001",
					},
					{
						productId: 33110,
						productName: "生椰拿铁",
						skuCode: "SP33110-00001",
					},
				],
				"repair",
			);

			const repair = await post<{
				code: number;
				result: {
					id: string;
					sellable_product_ids: string[];
					sellable_sku_codes: string[];
					sellable_quantity: number;
				};
			}>("/order/catalog/repairSellable", {
				id: create.body.result.id,
				sign: "AbC123xYz9",
			});

			expect(repair.response.status).toBe(200);
			expect(repair.body.result).toEqual(
				expect.objectContaining({
					id: create.body.result.id,
					sellable_quantity: 2,
				}),
			);
			expect(repair.body.result.sellable_product_ids).toHaveLength(2);
			expect(repair.body.result.sellable_sku_codes).toHaveLength(2);
			expect(repair.body.result.sellable_product_ids).not.toContain("test-product");
			expect(repair.body.result.sellable_sku_codes).not.toContain("test-sku");
			expect(
				repair.body.result.sellable_product_ids.every((productId) =>
					/^\d+$/.test(productId),
				),
			).toBe(true);
			expect(
				repair.body.result.sellable_sku_codes.every((skuCode) =>
					skuCode.startsWith("SP"),
				),
			).toBe(true);
		});
	});
});

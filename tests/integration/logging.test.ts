import { env } from "cloudflare:test";
import CryptoJS from "crypto-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CoffeeCardSyncError,
	syncLuckinCoffeeCards,
} from "../../src/controller/lkadmin/couponSync";
import {
	forwardLuckinMcpToolForSellableProduct,
	LuckinMcpForwardError,
} from "../../src/controller/order/luckinMcp";
import {
	miniprogramCreateOrderForSellableProduct,
	MiniprogramOrderError,
} from "../../src/controller/order/miniprogramCreateOrder";
import { appLogger } from "../../src/shared/logger";

const miniprogramAesKey = "CJQjAc1hYieC4QYb";
const miniprogramUid =
	"f931e729-4279-4d30-bdc5-0254af362e551787569733931-2926637-efAmj7k25Su8lEAGHeSrLLDaF7WCSl67RQEGsHnOQYYh3CdepZU4TszMDkSxpjkO";

afterEach(() => {
	vi.restoreAllMocks();
});

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

function encryptedMiniprogramResponse(payload: Record<string, unknown>) {
	return new Response(encryptMiniprogramPayload(payload), {
		headers: { "Content-Type": "text/plain;charset=UTF-8" },
	});
}

async function createMiniprogramOrderUser() {
	const id = `lg${Math.random().toString(36).slice(2, 10)}`.slice(0, 10);

	await env.DB.prepare(
		`INSERT INTO lucky_order_users (
			id,
			nickname,
			token,
			type,
			status,
			auth_mode,
			uid,
			openid,
			cookie,
			aes_key,
			miniprogram_version,
			is_delete
		)
		VALUES (?, ?, ?, 'lucky', 'enabled', 'miniprogram', ?, ?, ?, ?, '5587', 0)`,
	)
		.bind(
			id,
			`logging account ${id}`,
			"luckin-token",
			miniprogramUid,
			"openid-logging",
			`uid=${miniprogramUid}; session=secret-session`,
			miniprogramAesKey,
		)
		.run();

	return id;
}

async function createSellableProductForOrderUser(orderUserId: string) {
	const id = `sp${Math.random().toString(36).slice(2, 10)}`.slice(0, 10);

	await env.DB.prepare(
		`INSERT INTO lucky_sellable_products (
			id,
			sellable_product_ids,
			sellable_sku_codes,
			sellable_quantity,
			status,
			order_user_id,
			is_delete
		)
		VALUES (?, ?, ?, 1, 'pending', ?, 0)`,
	)
		.bind(id, JSON.stringify(["11447"]), JSON.stringify(["SP9636-00001"]), orderUserId)
		.run();

	return id;
}

async function createTokenOrderUser() {
	const id = `tk${Math.random().toString(36).slice(2, 10)}`.slice(0, 10);

	await env.DB.prepare(
		`INSERT INTO lucky_order_users (
			id,
			nickname,
			token,
			type,
			status,
			auth_mode,
			is_delete
		)
		VALUES (?, ?, ?, 'lucky', 'enabled', 'token', 0)`,
	)
		.bind(id, `token logging account ${id}`, "luckin-mcp-token")
		.run();

	return id;
}

function parseLogCall(call: unknown[]) {
	expect(call[0]).toBe("[lucky]");
	return JSON.parse(String(call[1])) as {
		level: string;
		scope: string;
		event: string;
		location: string;
		data: Record<string, unknown>;
	};
}

describe("structured logging", () => {
	it("writes JSON logs and redacts credentials while keeping business payload readable", () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => {});

		appLogger.info("test", "sample", {
			Authorization: "Bearer real-token",
			cookie: "uid=user-001; session=secret",
			payload: {
				productId: 11447,
				skuCode: "SP9636-00001",
			},
		});

		const log = parseLogCall(info.mock.calls[0]);
		expect(log).toMatchObject({
			level: "info",
			scope: "test",
			event: "sample",
			location: expect.stringContaining("logging.test.ts"),
			data: {
				Authorization: "[redacted]",
				cookie: "[redacted]",
				payload: {
					productId: 11447,
					skuCode: "SP9636-00001",
				},
			},
		});
	});

	it("logs Luckin miniprogram request params before encryption and response data after decryption", async () => {
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const orderUserId = await createMiniprogramOrderUser();

		const fetcher: typeof fetch = async () =>
			encryptedMiniprogramResponse({
				code: 1,
				msg: "success",
				content: {
					planList: [
						{
							link: "/pages/index/menu?couponNo=CFLOG&couponType=2",
							coffeeStockTitle: "日志咖啡券",
							stockDesc: "尚余1张",
						},
					],
				},
			});

		await syncLuckinCoffeeCards(env.DB, fetcher, {
			order_user_id: orderUserId,
		});

		const logs = info.mock.calls.map(parseLogCall);
		expect(logs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					scope: "src/controller/lkadmin/couponSync.ts:postLuckinJson",
					event: "third_party.request",
					location: expect.stringContaining("couponSync.ts"),
					data: expect.objectContaining({
						payloadBeforeEncrypt: {
							miniversion: "5587",
						},
						formParams: expect.objectContaining({
							cid: "230101",
							dk: "1",
							q: expect.objectContaining({
								length: expect.any(Number),
							}),
							sign: expect.any(String),
						}),
					}),
				}),
				expect.objectContaining({
					scope: "src/controller/lkadmin/couponSync.ts:postLuckinJson",
					event: "third_party.response",
					location: expect.stringContaining("couponSync.ts"),
					data: expect.objectContaining({
						responseAfterDecrypt: expect.objectContaining({
							code: 1,
							msg: "success",
							content: {
								planList: [
									expect.objectContaining({
										coffeeStockTitle: "日志咖啡券",
									}),
								],
							},
						}),
					}),
				}),
			]),
		);
	});

	it("logs and maps MCP fetch failures to a forwarding error", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const orderUserId = await createTokenOrderUser();
		const sellableProductId = await createSellableProductForOrderUser(orderUserId);
		const networkError = new Error("connect timeout");

		const fetcher: typeof fetch = async () => {
			throw networkError;
		};

		await expect(
			forwardLuckinMcpToolForSellableProduct(env.DB, fetcher, {
				id: sellableProductId,
				sign: "AbC123xYz9",
				toolName: "queryShopList",
				arguments: {
					deptName: "海西金谷",
				},
			}),
		).rejects.toMatchObject<LuckinMcpForwardError>({
			message: "Luckin MCP request failed",
			status: 502,
		});

		const logs = error.mock.calls.map(parseLogCall);
		expect(logs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					scope: "src/controller/order/luckinMcp.ts:forwardLuckinMcpToolForSellableProduct",
					event: "third_party.request.failed",
					location: expect.stringContaining("luckinMcp.ts"),
					data: expect.objectContaining({
						toolName: "queryShopList",
						error: expect.objectContaining({
							message: "connect timeout",
						}),
					}),
				}),
			]),
		);
	});

	it("logs and maps malformed MCP responses to a forwarding error", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const orderUserId = await createTokenOrderUser();
		const sellableProductId = await createSellableProductForOrderUser(orderUserId);

		const fetcher: typeof fetch = async () =>
			new Response("not-json", {
				headers: { "Content-Type": "application/json" },
			});

		await expect(
			forwardLuckinMcpToolForSellableProduct(env.DB, fetcher, {
				id: sellableProductId,
				sign: "AbC123xYz9",
				toolName: "queryShopList",
				arguments: {
					deptName: "海西金谷",
				},
			}),
		).rejects.toMatchObject<LuckinMcpForwardError>({
			message: "Invalid Luckin MCP response",
			status: 502,
		});

		const logs = error.mock.calls.map(parseLogCall);
		expect(logs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					scope: "src/controller/order/luckinMcp.ts:forwardLuckinMcpToolForSellableProduct",
					event: "third_party.response.invalid",
					location: expect.stringContaining("luckinMcp.ts"),
					data: expect.objectContaining({
						toolName: "queryShopList",
						error: expect.objectContaining({
							message: expect.stringContaining("JSON"),
						}),
					}),
				}),
			]),
		);
	});

	it("logs non-ok MCP responses at error level", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const orderUserId = await createTokenOrderUser();
		const sellableProductId = await createSellableProductForOrderUser(orderUserId);

		const fetcher: typeof fetch = async () =>
			new Response("upstream busy", { status: 503 });

		await expect(
			forwardLuckinMcpToolForSellableProduct(env.DB, fetcher, {
				id: sellableProductId,
				sign: "AbC123xYz9",
				toolName: "queryShopList",
				arguments: {
					deptName: "海西金谷",
				},
			}),
		).rejects.toMatchObject<LuckinMcpForwardError>({
			message: "Luckin MCP request failed",
			status: 502,
		});

		const logs = error.mock.calls.map(parseLogCall);
		expect(logs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					scope: "src/controller/order/luckinMcp.ts:forwardLuckinMcpToolForSellableProduct",
					event: "third_party.response.failed",
					data: expect.objectContaining({
						status: 503,
						rawResponse: "upstream busy",
					}),
				}),
			]),
		);
	});

	it("logs and maps coffee-card miniprogram fetch failures", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const orderUserId = await createMiniprogramOrderUser();
		const networkError = new Error("coupon upstream unavailable");

		const fetcher: typeof fetch = async () => {
			throw networkError;
		};

		await expect(
			syncLuckinCoffeeCards(env.DB, fetcher, {
				order_user_id: orderUserId,
			}),
		).rejects.toMatchObject<CoffeeCardSyncError>({
			message: "Luckin miniprogram request failed",
			status: 502,
		});

		const logs = error.mock.calls.map(parseLogCall);
		expect(logs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					scope: "src/controller/lkadmin/couponSync.ts:postLuckinJson",
					event: "third_party.request.failed",
					location: expect.stringContaining("couponSync.ts"),
					data: expect.objectContaining({
						path: "/resource/m/promotion/v2/myself/list",
						error: expect.objectContaining({
							message: "coupon upstream unavailable",
						}),
					}),
				}),
			]),
		);
	});

	it("logs non-ok coffee-card miniprogram responses at error level", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const orderUserId = await createMiniprogramOrderUser();

		const fetcher: typeof fetch = async () =>
			new Response("coupon upstream busy", { status: 503 });

		await expect(
			syncLuckinCoffeeCards(env.DB, fetcher, {
				order_user_id: orderUserId,
			}),
		).rejects.toMatchObject<CoffeeCardSyncError>({
			message: "Luckin miniprogram request failed",
			status: 502,
		});

		const logs = error.mock.calls.map(parseLogCall);
		expect(logs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					scope: "src/controller/lkadmin/couponSync.ts:postLuckinJson",
					event: "third_party.response.failed",
					data: expect.objectContaining({
						path: "/resource/m/promotion/v2/myself/list",
						status: 503,
						rawPrefix: "coupon upstream busy",
					}),
				}),
			]),
		);
	});

	it("logs invalid coffee-card miniprogram responses at error level", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const orderUserId = await createMiniprogramOrderUser();

		const fetcher: typeof fetch = async () =>
			new Response("not-encrypted-json", {
				headers: { "Content-Type": "text/plain;charset=UTF-8" },
			});

		await expect(
			syncLuckinCoffeeCards(env.DB, fetcher, {
				order_user_id: orderUserId,
			}),
		).rejects.toMatchObject<CoffeeCardSyncError>({
			message: "Invalid Luckin miniprogram response",
			status: 502,
		});

		const logs = error.mock.calls.map(parseLogCall);
		expect(logs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					scope: "src/controller/lkadmin/couponSync.ts:postLuckinJson",
					event: "third_party.response.invalid",
					data: expect.objectContaining({
						path: "/resource/m/promotion/v2/myself/list",
						rawPrefix: "not-encrypted-json",
					}),
				}),
			]),
		);
	});

	it("logs and maps create-order miniprogram fetch failures", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const orderUserId = await createMiniprogramOrderUser();
		const sellableProductId = await createSellableProductForOrderUser(orderUserId);
		const networkError = new Error("preview upstream timeout");

		const fetcher: typeof fetch = async () => {
			throw networkError;
		};

		await expect(
			miniprogramCreateOrderForSellableProduct(env.DB, fetcher, {
				id: sellableProductId,
				sign: "AbC123xYz9",
				deptId: 245062453,
				productList: [
					{
						amount: 1,
						productId: 11447,
						skuCode: "SP9636-00001",
					},
				],
				longitude: 116.392435,
				latitude: 39.982376,
			}),
		).rejects.toMatchObject<MiniprogramOrderError>({
			message: "Luckin miniprogram request failed",
			status: 502,
		});

		const logs = error.mock.calls.map(parseLogCall);
		expect(logs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					scope: "src/controller/order/miniprogramCreateOrder.ts:miniprogramCreateOrderForSellableProduct",
					event: "third_party.request.failed",
					location: expect.stringContaining("miniprogramCreateOrder.ts"),
					data: expect.objectContaining({
						path: "/resource/core/v2/order/preview",
						error: expect.objectContaining({
							message: "preview upstream timeout",
						}),
					}),
				}),
			]),
		);
	});

	it("logs non-ok create-order miniprogram responses at error level", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const orderUserId = await createMiniprogramOrderUser();
		const sellableProductId = await createSellableProductForOrderUser(orderUserId);

		const fetcher: typeof fetch = async () =>
			new Response("preview upstream busy", { status: 503 });

		await expect(
			miniprogramCreateOrderForSellableProduct(env.DB, fetcher, {
				id: sellableProductId,
				sign: "AbC123xYz9",
				deptId: 245062453,
				productList: [
					{
						amount: 1,
						productId: 11447,
						skuCode: "SP9636-00001",
					},
				],
				longitude: 116.392435,
				latitude: 39.982376,
			}),
		).rejects.toMatchObject<MiniprogramOrderError>({
			message: "Luckin miniprogram request failed",
			status: 502,
		});

		const logs = error.mock.calls.map(parseLogCall);
		expect(logs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					scope: "src/controller/order/miniprogramCreateOrder.ts:miniprogramCreateOrderForSellableProduct",
					event: "third_party.response.failed",
					data: expect.objectContaining({
						path: "/resource/core/v2/order/preview",
						status: 503,
						rawPrefix: "preview upstream busy",
					}),
				}),
			]),
		);
	});

	it("logs invalid create-order miniprogram responses at error level", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const orderUserId = await createMiniprogramOrderUser();
		const sellableProductId = await createSellableProductForOrderUser(orderUserId);

		const fetcher: typeof fetch = async () =>
			new Response("not-encrypted-json", {
				headers: { "Content-Type": "text/plain;charset=UTF-8" },
			});

		await expect(
			miniprogramCreateOrderForSellableProduct(env.DB, fetcher, {
				id: sellableProductId,
				sign: "AbC123xYz9",
				deptId: 245062453,
				productList: [
					{
						amount: 1,
						productId: 11447,
						skuCode: "SP9636-00001",
					},
				],
				longitude: 116.392435,
				latitude: 39.982376,
			}),
		).rejects.toMatchObject<MiniprogramOrderError>({
			message: "Invalid Luckin miniprogram response",
			status: 502,
		});

		const logs = error.mock.calls.map(parseLogCall);
		expect(logs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					scope: "src/controller/order/miniprogramCreateOrder.ts:miniprogramCreateOrderForSellableProduct",
					event: "third_party.response.invalid",
					data: expect.objectContaining({
						path: "/resource/core/v2/order/preview",
						rawPrefix: "not-encrypted-json",
					}),
				}),
			]),
		);
	});
});

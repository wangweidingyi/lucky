import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const adminToken = "lkadmin-dev-token";
const authHeaders = {
	"Content-Type": "application/json",
	Authorization: `Bearer ${adminToken}`,
};
const idPattern = /^[a-zA-Z0-9]{10}$/;

async function post<T>(
	path: string,
	body: Record<string, unknown> = {},
	headers: Record<string, string> = authHeaders,
) {
	const response = await SELF.fetch(`http://local.test${path}`, {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
	const text = await response.text();

	let parsed = {} as T;
	try {
		parsed = text ? (JSON.parse(text) as T) : ({} as T);
	} catch {
		parsed = {} as T;
	}

	return { response, body: parsed };
}

async function createOrderUser(overrides: Record<string, unknown> = {}) {
	const { response, body } = await post<{
		code: number;
		result: {
			id: string;
			nickname: string;
			token: string;
			type: string;
			status: string;
			is_delete: number;
		};
	}>("/lkadmin/order-users/create", {
		nickname: "admin test account",
		token: "luckin-token",
		...overrides,
	});

	expect(response.status).toBe(201);
	return body.result;
}

describe("lkadmin management API", () => {
	it("rejects protected routes without the fixed bearer token", async () => {
		const { response, body } = await post<{
			code: number;
			errors: Array<{ message: string }>;
		}>("/lkadmin/order-users/list", {}, { "Content-Type": "application/json" });

		expect(response.status).toBe(401);
		expect(body.errors[0].message).toBe("Unauthorized");
	});

	it("validates login through a fixed token string", async () => {
		const bad = await post<{ errors: Array<{ message: string }> }>(
			"/lkadmin/login",
			{ token: "wrong" },
			{ "Content-Type": "application/json" },
		);
		expect(bad.response.status).toBe(401);

		const good = await post<{ result: { token: string } }>(
			"/lkadmin/login",
			{ token: adminToken },
			{ "Content-Type": "application/json" },
		);
		expect(good.response.status).toBe(200);
		expect(good.body.result.token).toBe(adminToken);
	});

	it("creates, lists, updates, reads, and soft deletes order users", async () => {
		const created = await createOrderUser({
			nickname: "before update",
			status: "disabled",
			auth_mode: "miniprogram",
			uid: "uid-001",
			openid: "openid-001",
			black_box: "black-box",
			notify_code: "notify-code",
			csid: "csid",
			pay_type: "7",
			miniprogram_version: "5587",
			aes_key: "aes-key",
			base_url: "https://example.test",
			cookie: "uid=uid-001",
		});

		expect(created).toEqual(
			expect.objectContaining({
				id: expect.stringMatching(idPattern),
				nickname: "before update",
				status: "disabled",
				auth_mode: "miniprogram",
				is_delete: 0,
			}),
		);

		const list = await post<{ result: Array<{ id: string; nickname: string }> }>(
			"/lkadmin/order-users/list",
		);
		expect(list.response.status).toBe(200);
		expect(list.body.result).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: created.id, nickname: "before update" }),
			]),
		);

		const update = await post<{ result: { id: string; nickname: string } }>(
			"/lkadmin/order-users/update",
			{ id: created.id, nickname: "after update", status: "enabled" },
		);
		expect(update.response.status).toBe(200);
		expect(update.body.result).toEqual(
			expect.objectContaining({ id: created.id, nickname: "after update" }),
		);

		const read = await post<{ result: { id: string; status: string } }>(
			"/lkadmin/order-users/read",
			{ id: created.id },
		);
		expect(read.response.status).toBe(200);
		expect(read.body.result.status).toBe("enabled");

		const deleted = await post<{ result: { id: string; is_delete: number } }>(
			"/lkadmin/order-users/delete",
			{ id: created.id },
		);
		expect(deleted.response.status).toBe(200);
		expect(deleted.body.result.is_delete).toBe(1);

		const readAfterDelete = await post("/lkadmin/order-users/read", {
			id: created.id,
		});
		expect(readAfterDelete.response.status).toBe(404);
	});

	it("creates, lists, updates, reads, and soft deletes sellable products", async () => {
		const user = await createOrderUser();
		const created = await post<{
			result: {
				id: string;
				sellable_product_ids: string[];
				sellable_sku_codes: string[];
				sellable_quantity: number;
				status: string;
				order_user_id: string;
				third_party_remark_id: string;
				is_delete: number;
			};
		}>("/lkadmin/sellable-products/create", {
			sellable_product_ids: ["5293", "5294"],
			sellable_sku_codes: ["SP3713-00051", "SP3713-00052"],
			sellable_quantity: 2,
			status: "waiting",
			order_user_id: user.id,
			third_party_remark_id: "A9z",
			third_party_order_id: "third-order-001",
			third_party_product_id: "third-product-001",
		});

		expect(created.response.status).toBe(201);
		expect(created.body.result).toEqual(
			expect.objectContaining({
				id: expect.stringMatching(idPattern),
				sellable_product_ids: ["5293", "5294"],
				sellable_sku_codes: ["SP3713-00051", "SP3713-00052"],
				sellable_quantity: 2,
				order_user_id: user.id,
				third_party_remark_id: "A9z",
				is_delete: 0,
			}),
		);

		const id = created.body.result.id;
		const list = await post<{ result: Array<{ id: string }> }>(
			"/lkadmin/sellable-products/list",
		);
		expect(list.body.result).toEqual(
			expect.arrayContaining([expect.objectContaining({ id })]),
		);

		const update = await post<{
			result: { id: string; sellable_quantity: number; status: string };
		}>("/lkadmin/sellable-products/update", {
			id,
			sellable_quantity: 3,
			status: "done",
		});
		expect(update.response.status).toBe(200);
		expect(update.body.result).toEqual(
			expect.objectContaining({ id, sellable_quantity: 3, status: "done" }),
		);

		const read = await post<{ result: { id: string; status: string } }>(
			"/lkadmin/sellable-products/read",
			{ id },
		);
		expect(read.response.status).toBe(200);
		expect(read.body.result.status).toBe("done");

		const deleted = await post<{ result: { id: string; is_delete: number } }>(
			"/lkadmin/sellable-products/delete",
			{ id },
		);
		expect(deleted.response.status).toBe(200);
		expect(deleted.body.result.is_delete).toBe(1);
	});

	it("creates, lists, updates, reads, and soft deletes Luckin catalog products", async () => {
		const created = await post<{
			result: {
				id: number;
				productId: number;
				productName: string;
				skuCode: string;
				tags: string[];
				attrs: Array<Record<string, unknown>>;
				raw: Record<string, unknown>;
				isDelete: number;
			};
		}>("/lkadmin/products/create", {
			productId: 990001,
			productName: "后台测试拿铁",
			skuCode: "SKU-ADMIN-001",
			pictureUrl: "https://example.test/latte.png",
			initialPrice: 19,
			estimatePrice: 9.9,
			tags: ["后台"],
			attrs: [{ name: "温度", value: "冰" }],
			raw: { source: "admin-test" },
			sourceQuery: "后台测试",
		});

		expect(created.response.status).toBe(201);
		expect(created.body.result).toEqual(
			expect.objectContaining({
				productId: 990001,
				productName: "后台测试拿铁",
				skuCode: "SKU-ADMIN-001",
				tags: ["后台"],
				isDelete: 0,
			}),
		);

		const id = created.body.result.id;
		const list = await post<{ result: Array<{ id: number; productName: string }> }>(
			"/lkadmin/products/list",
		);
		expect(list.body.result).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id, productName: "后台测试拿铁" }),
			]),
		);

		const update = await post<{ result: { id: number; productName: string } }>(
			"/lkadmin/products/update",
			{ id, productName: "后台测试生椰拿铁", estimatePrice: 8.8 },
		);
		expect(update.response.status).toBe(200);
		expect(update.body.result.productName).toBe("后台测试生椰拿铁");

		const read = await post<{ result: { id: number; estimatePrice: number } }>(
			"/lkadmin/products/read",
			{ id },
		);
		expect(read.response.status).toBe(200);
		expect(read.body.result.estimatePrice).toBe(8.8);

		const deleted = await post<{ result: { id: number; isDelete: number } }>(
			"/lkadmin/products/delete",
			{ id },
		);
		expect(deleted.response.status).toBe(200);
		expect(deleted.body.result.isDelete).toBe(1);
	});
});

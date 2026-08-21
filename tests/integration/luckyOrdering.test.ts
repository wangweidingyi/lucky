import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const idPattern = /^[a-zA-Z0-9]{16}$/;

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
					third_party_order_id: string;
				};
			}>("/sellable-products/update", {
				id,
				sellable_product_ids: ["prod-004", "prod-005"],
				sellable_sku_codes: ["sku-004", "sku-005"],
				sellable_quantity: 4,
				third_party_order_id: "third-order-002",
			});
			expect(update.response.status).toBe(200);
			expect(update.body.result).toEqual(
				expect.objectContaining({
					id,
					sellable_product_ids: ["prod-004", "prod-005"],
					sellable_sku_codes: ["sku-004", "sku-005"],
					sellable_quantity: 4,
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
				order_user_id: "unknownUser00001",
			});

			expect(response.status).toBe(400);
			expect(body.success).toBe(false);
			expect(body.errors[0].message).toContain("order_user_id");
		});
	});
});

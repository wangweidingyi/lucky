import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const adminToken = "lkadmin-dev-token";
const idPattern = /^[a-zA-Z0-9]{10}$/;

async function post<T>(path: string, body: Record<string, unknown> = {}) {
	const response = await SELF.fetch(`http://local.test${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${adminToken}`,
		},
		body: JSON.stringify(body),
	});
	const text = await response.text();

	return {
		response,
		body: (text ? JSON.parse(text) : {}) as T,
	};
}

describe("miniprogram admin API", () => {
	it("manages miniprogram order users without using legacy order user routes", async () => {
		const create = await post<{
			code: number;
			result: {
				id: string;
				nickname: string;
				status: string;
				uid: string;
				miniprogram_version: string;
				aes_key: string;
				base_url: string;
			};
		}>("/lkadmin/miniprogram/order-users/create", {
			nickname: "mini admin account",
			uid: "uid-admin-test",
			openid: "openid-admin-test",
		});

		expect(create.response.status).toBe(201);
		expect(create.body.result).toEqual(
			expect.objectContaining({
				id: expect.stringMatching(idPattern),
				nickname: "mini admin account",
				status: "enabled",
				uid: "uid-admin-test",
				miniprogram_version: "5587",
				aes_key: "CJQjAc1hYieC4QYb",
				base_url: "https://capi.lkcoffee.com",
			}),
		);

		const list = await post<{
			code: number;
			result: Array<{ id: string; uid: string }>;
		}>("/lkadmin/miniprogram/order-users/list");
		expect(list.response.status).toBe(200);
		expect(list.body.result).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: create.body.result.id,
					uid: "uid-admin-test",
				}),
			]),
		);
	});

	it("lists miniprogram sellable rows from the new table shape", async () => {
		const rows = await post<{
			code: number;
			result: Array<{
				id: string;
				coffeeCardId: number;
				status: string;
				orderUserId: string;
			}>;
		}>("/lkadmin/miniprogram/sellable-products/list");

		expect(rows.response.status).toBe(200);
		expect(Array.isArray(rows.body.result)).toBe(true);
	});

	it("requires confirmation before regenerating mismatched card sellable rows", async () => {
		const orderUserId = "AdmCard001";
		const cardId = 987654;

		await env.DB.prepare(
			`INSERT INTO miniprogram_order_users (
				id,
				nickname,
				status,
				uid,
				miniprogram_version,
				aes_key,
				base_url,
				is_delete
			)
			VALUES (?, 'card admin', 'enabled', 'uid-card-admin', '5587', 'CJQjAc1hYieC4QYb', 'https://capi.lkcoffee.com', 0)`,
		)
			.bind(orderUserId)
			.run();

		await env.DB.prepare(
			`INSERT INTO miniprogram_coffee_cards (
				id,
				order_user_id,
				cafe_ku_id,
				coupon_no,
				coupon_type,
				coffee_voucher_type,
				card_name,
				usable_quantity,
				generated_sellable_count,
				raw,
				is_delete
			)
			VALUES (?, ?, 'CK-ADMIN-GEN', 'CK-ADMIN-GEN', 2, 0, '待生成卡券', 2, 0, '{}', 0)`,
		)
			.bind(cardId, orderUserId)
			.run();

		const withoutConfirmation = await post<{
			errors: Array<{ message: string }>;
		}>("/lkadmin/miniprogram/coffee-cards/generate-sellables", { id: cardId });

		expect(withoutConfirmation.response.status).toBe(409);
		expect(withoutConfirmation.body.errors[0].message).toContain(
			"可售记录数量不一致",
		);

		const generated = await post<{
			result: {
				card: { id: number; generatedSellableCount: number };
				sellables: Array<{ id: string; sign: string; status: string }>;
				usableQuantity: number;
				activeSellableCount: number;
				regenerated: boolean;
			};
		}>("/lkadmin/miniprogram/coffee-cards/generate-sellables", {
			id: cardId,
			force: true,
		});

		expect(generated.response.status).toBe(200);
		expect(generated.body.result).toEqual(
			expect.objectContaining({
				usableQuantity: 2,
				activeSellableCount: 2,
				regenerated: true,
			}),
		);
		expect(generated.body.result.card.generatedSellableCount).toBe(2);
		expect(generated.body.result.sellables).toHaveLength(2);
		for (const sellable of generated.body.result.sellables) {
			expect(sellable.id).toMatch(/^[0-9A-Z_a-z-]{31}$/);
			expect(sellable.sign).toMatch(/^[0-9A-Z_a-z-]{31}$/);
			expect(sellable.status).toBe("waiting");
		}

		const noOp = await post<{
			result: {
				activeSellableCount: number;
				regenerated: boolean;
				sellables: Array<{ id: string }>;
			};
		}>("/lkadmin/miniprogram/coffee-cards/generate-sellables", {
			id: cardId,
		});

		expect(noOp.response.status).toBe(200);
		expect(noOp.body.result).toEqual(
			expect.objectContaining({
				activeSellableCount: 2,
				regenerated: false,
			}),
		);
		expect(noOp.body.result.sellables.map((sellable) => sellable.id)).toEqual(
			generated.body.result.sellables.map((sellable) => sellable.id),
		);
	});
});

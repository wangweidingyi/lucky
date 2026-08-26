import { SELF } from "cloudflare:test";
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
});

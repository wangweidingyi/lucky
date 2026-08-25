import { env } from "cloudflare:test";
import CryptoJS from "crypto-js";
import { describe, expect, it } from "vitest";
import {
	previewLuckinCoffeeCardProducts,
	syncLuckinCoffeeCardProducts,
	syncLuckinCoffeeCards,
} from "../../src/controller/lkadmin/couponSync";

const miniprogramAesKey = "CJQjAc1hYieC4QYb";
const miniprogramUid =
	"f931e729-4279-4d30-bdc5-0254af362e551787569733931-2926637-efAmj7k25Su8lEAGHeSrLLDaF7WCSl67RQEGsHnOQYYh3CdepZU4TszMDkSxpjkO";

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

function encryptedMiniprogramResponse(payload: Record<string, unknown>) {
	return new Response(encryptMiniprogramPayload(payload), {
		headers: { "Content-Type": "text/plain;charset=UTF-8" },
	});
}

async function createMiniprogramOrderUser() {
	const id = `cp${Math.random().toString(36).slice(2, 10)}`.slice(0, 10);

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
			`coupon account ${id}`,
			"luckin-token",
			miniprogramUid,
			"openid-coupon-sync",
			`uid=${miniprogramUid}`,
			miniprogramAesKey,
		)
		.run();

	return id;
}

async function requestPayload(request: Request) {
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

	return decryptMiniprogramPayload(String(body.q));
}

describe("Luckin coupon sync", () => {
	it("syncs the miniprogram coffee-card list through myself list and stores remaining usable quantity", async () => {
		const orderUserId = await createMiniprogramOrderUser();
		const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];

		const fetcher: typeof fetch = async (input, init) => {
			const request = new Request(input, init);
			expect(request.method).toBe("POST");
			expect(request.headers.get("cookie")).toBe(`uid=${miniprogramUid}`);
			const payload = await requestPayload(request);
			calls.push({ url: request.url, payload });

			expect(request.url).toBe(
				"https://capi.lkcoffee.com/resource/m/promotion/v2/myself/list",
			);
			expect(payload).toEqual({ miniversion: "5587" });

			return encryptedMiniprogramResponse({
				code: 1,
				msg: "success",
				content: {
					describe: "",
					planList: [
						{
							link: "/pages/index/menu?isCouponUse=true&couponNo=CF001&couponType=2",
							coffeeVoucherType: 0,
							coffeeStockTitle: "标准美式咖啡券",
							stockDesc: "尚余3张",
							stockNum: 3,
						},
						{
							link: "/pages/index/menu?isCouponUse=true&couponNo=CF002&couponType=2",
							coffeeStockTitle: "轻乳茶饮咖啡券",
							stockDesc: "尚余2次",
						},
						{
							link: "/pages/index/menu?isCouponUse=true&couponNo=CF003&couponType=3",
							coffeeVoucherType: 1,
							coffeeStockTitle: "超值十次卡",
							punchCardDesc: "已使用{0}次，还剩{10}次",
							stockNum: 0,
						},
					],
					riskPlanList: [],
				},
			});
		};

		const result = await syncLuckinCoffeeCards(env.DB, fetcher, {
			order_user_id: orderUserId,
		});

		expect(calls).toHaveLength(1);
		expect(result.coupons).toEqual([
			expect.objectContaining({
				orderUserId,
				cafeKuId: "CF001",
				couponNo: "CF001",
				coffeeVoucherType: 2,
				cardName: "标准美式咖啡券",
				usableQuantity: 3,
			}),
			expect.objectContaining({
				orderUserId,
				cafeKuId: "CF002",
				couponNo: "CF002",
				coffeeVoucherType: 2,
				cardName: "轻乳茶饮咖啡券",
				usableQuantity: 2,
			}),
			expect.objectContaining({
				orderUserId,
				cafeKuId: "CF003",
				couponNo: "CF003",
				coffeeVoucherType: 3,
				cardName: "超值十次卡",
				usableQuantity: 10,
			}),
		]);
	});

	it("syncs coupon usable products and creates one sellable row for each remaining use", async () => {
		const orderUserId = await createMiniprogramOrderUser();
		const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];

		const fetcher: typeof fetch = async (input, init) => {
			const request = new Request(input, init);
			expect(request.method).toBe("POST");
			const payload = await requestPayload(request);
			calls.push({ url: request.url, payload });

			if (request.url.endsWith("/resource/m/promotion/cardcoupon/info")) {
				expect(payload).toEqual({ couponType: 2, couponNo: "CK002" });
				return encryptedMiniprogramResponse({
					code: 1,
					msg: "success",
					content: {
						coffeeStoreRe: {
							cafeKuId: "CK002",
							couponNo: "CF002",
							coffeeVoucherType: 1,
							coffeeStockTitle: "剩余两次咖啡券",
							remainCount: 2,
						},
					},
				});
			}

			expect(request.url).toBe(
				"https://capi.lkcoffee.com/resource/core/v3/product/cardCouponZone",
			);
			expect(payload).toEqual({
				deptId: 613299,
				supportTakeout: 0,
				couponType: 2,
				couponNo: "CK002",
			});

			return encryptedMiniprogramResponse({
				code: 1,
				msg: "success",
				content: {
					productList: [
						{
							productId: 5151,
							skuCode: "SP3571-00244",
							name: "标准美式",
							pictureUrl: "https://img.example.test/americano.png",
							initialPrice: 19,
							estimatePrice: 0,
							productAttrs: [{ name: "温度", value: "冰" }],
						},
						{
							productId: 5152,
							skuCode: "SP3571-00245",
							productName: "生椰拿铁",
							initialPrice: 29,
							estimatePrice: 0,
						},
					],
				},
			});
		};

		const result = await syncLuckinCoffeeCardProducts(env.DB, fetcher, {
			order_user_id: orderUserId,
			cafe_ku_id: "CK002",
			coupon_type: 2,
			deptId: 613299,
			supportTakeout: 0,
			selected_products: [{ productId: 5152, skuCode: "SP3571-00245" }],
		});

		expect(calls.map((call) => call.url)).toEqual([
			"https://capi.lkcoffee.com/resource/m/promotion/cardcoupon/info",
			"https://capi.lkcoffee.com/resource/core/v3/product/cardCouponZone",
		]);
		expect(result).toEqual(
			expect.objectContaining({
				productCount: 1,
				generatedSellableCount: 2,
				usableQuantity: 2,
				cafeKuId: "CK002",
			}),
		);

		const products = await env.DB.prepare(
			`SELECT product_id, sku_code, product_name, source_query
			 FROM lucky_products
			 WHERE product_id IN (5151, 5152)
			 ORDER BY product_id ASC`,
		).all<{
			product_id: number;
			sku_code: string;
			product_name: string;
			source_query: string;
		}>();
		expect(products.results).toEqual([
			{
				product_id: 5152,
				sku_code: "SP3571-00245",
				product_name: "生椰拿铁",
				source_query: "coffee-card:CK002",
			},
		]);

		const sellables = await env.DB.prepare(
			`SELECT sellable_product_ids, sellable_sku_codes, sellable_quantity, status, order_user_id, third_party_product_id
			 FROM lucky_sellable_products
			 WHERE third_party_product_id = 'coffee-card:CK002' AND is_delete = 0
			 ORDER BY id ASC`,
		).all<{
			sellable_product_ids: string;
			sellable_sku_codes: string;
			sellable_quantity: number;
			status: string;
			order_user_id: string;
			third_party_product_id: string;
		}>();
		expect(sellables.results).toHaveLength(2);
		for (const sellable of sellables.results) {
			expect(JSON.parse(sellable.sellable_product_ids)).toEqual(["5152"]);
			expect(JSON.parse(sellable.sellable_sku_codes)).toEqual(["SP3571-00245"]);
			expect(sellable.sellable_quantity).toBe(1);
			expect(sellable.status).toBe("waiting");
			expect(sellable.order_user_id).toBe(orderUserId);
			expect(sellable.third_party_product_id).toBe("coffee-card:CK002");
		}
	});

	it("previews coffee-card usable products without storing products or sellable rows", async () => {
		const orderUserId = await createMiniprogramOrderUser();

		const fetcher: typeof fetch = async (input, init) => {
			const request = new Request(input, init);
			expect(request.method).toBe("POST");
			const payload = await requestPayload(request);

			if (request.url.endsWith("/resource/m/promotion/cardcoupon/info")) {
				expect(payload).toEqual({ couponType: 2, couponNo: "CK003" });
				return encryptedMiniprogramResponse({
					code: 1,
					msg: "success",
					content: {
						coffeeStoreRe: {
							cafeKuId: "CK003",
							coffeeStockTitle: "待选择咖啡券",
							stockDesc: "尚余4张",
						},
					},
				});
			}

			expect(request.url).toBe(
				"https://capi.lkcoffee.com/resource/core/v3/product/cardCouponZone",
			);
			expect(payload).toEqual({
				deptId: 613299,
				supportTakeout: 0,
				couponType: 2,
				couponNo: "CK003",
			});

			return encryptedMiniprogramResponse({
				code: 1,
				msg: "success",
				content: {
					productList: [
						{
							productId: 6151,
							skuCode: "SP3571-10244",
							name: "标准美式",
						},
						{
							productId: 6152,
							skuCode: "SP3571-10245",
							name: "生椰拿铁",
						},
					],
				},
			});
		};

		const result = await previewLuckinCoffeeCardProducts(env.DB, fetcher, {
			order_user_id: orderUserId,
			cafe_ku_id: "CK003",
			coupon_type: 2,
			deptId: 613299,
			supportTakeout: 0,
		});

		expect(result).toEqual(
			expect.objectContaining({
				cafeKuId: "CK003",
				usableQuantity: 4,
				productCount: 2,
			}),
		);
		expect(result.products.map((product) => product.productId)).toEqual([6151, 6152]);

		const products = await env.DB.prepare(
			`SELECT product_id FROM lucky_products WHERE product_id IN (6151, 6152)`,
		).all();
		expect(products.results).toEqual([]);

		const sellables = await env.DB.prepare(
			`SELECT id FROM lucky_sellable_products WHERE third_party_product_id = 'coffee-card:CK003'`,
		).all();
		expect(sellables.results).toEqual([]);
	});
});

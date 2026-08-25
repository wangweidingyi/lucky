import CryptoJS from "crypto-js";
import { z } from "zod";
import { findActiveOrderUser, type OrderUserRow } from "../../models/LuckyOrderUsers";
import { upsertCoffeeCard, type CoffeeCardRow } from "../../models/luckyCoffeeCards";
import { upsertLuckinProducts } from "../../models/luckyProducts";
import { serializeArray } from "../../models/luckySellableProducts";
import { generateId } from "../../shared/id";
import { appLogger } from "../../shared/logger";

const miniprogramApiBaseUrl = "https://capi.lkcoffee.com";
const coffeeCardListPath = "/resource/m/promotion/v2/myself/list";
const cardCouponInfoPath = "/resource/m/promotion/cardcoupon/info";
const cardCouponZonePath = "/resource/core/v3/product/cardCouponZone";
const defaultCid = "230101";
const defaultAesKey = "CJQjAc1hYieC4QYb";
const defaultMiniprogramVersion = "5587";
const defaultMiniprogramUid =
	"f931e729-4279-4d30-bdc5-0254af362e551787569733931-2926637-efAmj7k25Su8lEAGHeSrLLDaF7WCSl67RQEGsHnOQYYh3CdepZU4TszMDkSxpjkO";
const defaultMiniprogramMid = "2926637";
const defaultMiniprogramSid = "386165";
const defaultMiniprogramCsid = "eb460133-d7de-9d3d-421b-b2054a571373";
const defaultMiniprogramAkv = "lk-wxmp-v5.3.22";
const defaultMiniprogramReferer =
	"https://servicewechat.com/wx21c7506e98a2fe75/929/page-frame.html";
const defaultMiniprogramUserAgent =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Mac MacWechat/WMPF MacWechat/3.8.7(0x13080712) UnifiedPCMacWechat(0xf2641c35) XWEB/25366";

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(jsonValueSchema),
	]),
);

export const syncCoffeeCardsBodySchema = z.object({
	order_user_id: z.string().regex(/^[a-zA-Z0-9]{10}$/),
});

const coffeeCardProductsBaseBodySchema = z.object({
	order_user_id: z.string().regex(/^[a-zA-Z0-9]{10}$/),
	cafe_ku_id: z.string().min(1).optional(),
	coupon_no: z.string().min(1).optional(),
	coupon_type: z.number().int().positive().optional().default(2),
	deptId: z.number().int().positive(),
	supportTakeout: z.number().int().min(0).max(1).optional().default(0),
	usable_quantity: z.number().int().min(0).optional(),
});

export const previewCoffeeCardProductsBodySchema = coffeeCardProductsBaseBodySchema;

export const syncCoffeeCardProductsBodySchema =
	coffeeCardProductsBaseBodySchema.extend({
		selected_products: z
			.array(
				z.object({
					productId: z.number().int().positive(),
					skuCode: z.string().min(1),
				}),
			)
			.min(1),
	});

type SyncCoffeeCardsInput = z.infer<typeof syncCoffeeCardsBodySchema>;
type PreviewCoffeeCardProductsInput = z.infer<
	typeof previewCoffeeCardProductsBodySchema
>;
type SyncCoffeeCardProductsInput = z.infer<typeof syncCoffeeCardProductsBodySchema>;

type MiniprogramAuthConfig = {
	aesKey?: string;
	baseUrl?: string;
	cid?: string;
	cookie?: string;
	csid?: string;
	uid?: string;
	version?: string;
};

type ResolvedMiniprogramAuth = Required<
	Pick<MiniprogramAuthConfig, "aesKey" | "baseUrl" | "cid" | "version">
> &
	MiniprogramAuthConfig;

type LuckinResponse = {
	code?: number;
	msg?: string;
	content?: unknown;
	busiCode?: string;
	status?: unknown;
};

export class CoffeeCardSyncError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404 | 409 | 502 = 502,
	) {
		super(message);
	}
}

export async function syncLuckinCoffeeCards(
	db: D1Database,
	fetcher: typeof fetch,
	input: SyncCoffeeCardsInput,
) {
	input = syncCoffeeCardsBodySchema.parse(input);
	const orderUser = await getOrderUserOrThrow(db, input.order_user_id);
	const auth = resolveMiniprogramAuth(orderUser.token, getOrderUserMiniprogramConfig(orderUser));
	const response = await postLuckinJson(fetcher, coffeeCardListPath, auth, {
		miniversion: auth.version,
	});
	const content = extractLuckinContent(response, "coffee card list");
	const cards = extractCoffeeCards(content);
	const syncedCards: CoffeeCardRow[] = [];

	for (const card of cards) {
		const normalized = normalizeCoffeeCard(input.order_user_id, card);
		if (!normalized) {
			continue;
		}

		const row = await upsertCoffeeCard(db, normalized);
		if (row) {
			syncedCards.push(row);
		}
	}

	return {
		coupons: syncedCards,
		cards: syncedCards,
		syncedCount: syncedCards.length,
		rawCount: cards.length,
	};
}

export async function syncLuckinCoffeeCardProducts(
	db: D1Database,
	fetcher: typeof fetch,
	input: SyncCoffeeCardProductsInput,
) {
	input = syncCoffeeCardProductsBodySchema.parse(input);
	const { cafeKuId, cardInfo, products, usableQuantity } =
		await fetchCoffeeCardUsableProducts(db, fetcher, input);

	if (!products.length) {
		throw new CoffeeCardSyncError("No usable products found for coffee card", 409);
	}

	const selectedProducts = filterSelectedProducts(products, input.selected_products);
	if (selectedProducts.length !== input.selected_products.length) {
		throw new CoffeeCardSyncError(
			"Selected products are not usable for coffee card",
			409,
		);
	}

	const sourceQuery = `coffee-card:${cafeKuId}`;
	const productCount = await upsertLuckinProducts(db, selectedProducts, sourceQuery);
	const generatedSellableCount = await createSellableRowsForCoffeeCard(
		db,
		input.order_user_id,
		cafeKuId,
		usableQuantity,
		selectedProducts.map((product) => ({
			productId: product.productId,
			skuCode: product.skuCode,
		})),
	);
	const cardRow = await upsertCoffeeCard(db, {
		orderUserId: input.order_user_id,
		cafeKuId,
		couponNo: stringValue(cardInfo.couponNo) ?? input.coupon_no ?? null,
		coffeeVoucherType:
			numberValue(cardInfo.coffeeVoucherType) ?? input.coupon_type ?? 0,
		cardName: extractCardName(cardInfo),
		usableQuantity,
		syncedProductCount: productCount,
		generatedSellableCount,
		raw: asRecord(cardInfo),
	});

	return {
		card: cardRow,
		cafeKuId,
		productCount,
		generatedSellableCount,
		usableQuantity,
		products: selectedProducts,
	};
}

export async function previewLuckinCoffeeCardProducts(
	db: D1Database,
	fetcher: typeof fetch,
	input: PreviewCoffeeCardProductsInput,
) {
	input = previewCoffeeCardProductsBodySchema.parse(input);
	const { cafeKuId, cardInfo, products, usableQuantity } =
		await fetchCoffeeCardUsableProducts(db, fetcher, input);

	if (!products.length) {
		throw new CoffeeCardSyncError("No usable products found for coffee card", 409);
	}

	return {
		cafeKuId,
		cardInfo,
		productCount: products.length,
		usableQuantity,
		products,
	};
}

async function getOrderUserOrThrow(db: D1Database, id: string) {
	const orderUser = await findActiveOrderUser(db, id);

	if (!orderUser) {
		throw new CoffeeCardSyncError("Order user not found", 404);
	}

	return orderUser;
}

function extractCoffeeCards(content: Record<string, unknown>) {
	if (Array.isArray(content.planList)) {
		return content.planList.filter(isRecord);
	}

	const direct = content.usableList;
	if (Array.isArray(direct)) {
		return direct.filter(isRecord);
	}

	if (Array.isArray(content.list)) {
		return content.list.filter(isRecord);
	}

	return [];
}

function normalizeCoffeeCard(orderUserId: string, raw: Record<string, unknown>) {
	const linkParams = parseLinkParams(stringValue(raw.link));
	const couponNo =
		stringValue(raw.couponNo) ??
		linkParams.get("couponNo") ??
		linkParams.get("cafeKuId");
	const cafeKuId = stringValue(raw.cafeKuId) ?? stringValue(raw.cardId) ?? couponNo;

	if (!cafeKuId) {
		return null;
	}

	return {
		orderUserId,
		cafeKuId,
		couponNo: couponNo ?? null,
		coffeeVoucherType:
			numberValue(linkParams.get("couponType")) ??
			numberValue(raw.coffeeVoucherType) ??
			0,
		cardName: extractCardName(raw),
		usableQuantity: extractUsableQuantity(raw) ?? 1,
		raw,
	};
}

function extractCoffeeCardInfo(content: Record<string, unknown>) {
	const coffeeStoreRe = isRecord(content.coffeeStoreRe) ? content.coffeeStoreRe : null;
	const couponInfoRe = isRecord(content.couponInfoRe) ? content.couponInfoRe : null;

	return coffeeStoreRe ?? couponInfoRe ?? content;
}

function extractProductList(content: Record<string, unknown>) {
	if (Array.isArray(content.productList)) {
		return content.productList.filter(isRecord);
	}

	if (isRecord(content.content) && Array.isArray(content.content.productList)) {
		return content.content.productList.filter(isRecord);
	}

	return [];
}

function normalizeLuckinProduct(product: Record<string, unknown>) {
	const productId = numberValue(product.productId);
	const skuCode = stringValue(product.skuCode);
	const productName =
		stringValue(product.productName) ??
		stringValue(product.name) ??
		stringValue(product.title);

	if (!productId || !skuCode || !productName) {
		return null;
	}

	return {
		...product,
		productId,
		skuCode,
		productName,
		pictureUrl:
			stringValue(product.pictureUrl) ??
			stringValue(product.defaultPicUrl) ??
			stringValue(product.picUrl) ??
			null,
		initialPrice: numberValue(product.initialPrice),
		estimatePrice: numberValue(product.estimatePrice),
		tags: Array.isArray(product.tags)
			? product.tags.filter((tag): tag is string => typeof tag === "string")
			: Array.isArray(product.tagList)
				? product.tagList
						.map((tag) =>
							typeof tag === "string"
								? tag
								: isRecord(tag)
									? stringValue(tag.name) ?? stringValue(tag.text)
									: null,
						)
						.filter((tag): tag is string => Boolean(tag))
				: [],
		productAttrs: Array.isArray(product.productAttrs) ? product.productAttrs : [],
	};
}

type NormalizedLuckinProduct = NonNullable<ReturnType<typeof normalizeLuckinProduct>>;

async function fetchCoffeeCardUsableProducts(
	db: D1Database,
	fetcher: typeof fetch,
	input: PreviewCoffeeCardProductsInput,
) {
	const orderUser = await getOrderUserOrThrow(db, input.order_user_id);
	const auth = resolveMiniprogramAuth(orderUser.token, getOrderUserMiniprogramConfig(orderUser));
	const cafeKuId = input.cafe_ku_id ?? input.coupon_no;

	if (!cafeKuId) {
		throw new CoffeeCardSyncError("cafe_ku_id or coupon_no is required", 400);
	}

	const infoResponse = await postLuckinJson(fetcher, cardCouponInfoPath, auth, {
		couponType: input.coupon_type,
		couponNo: cafeKuId,
	});
	const infoContent = extractLuckinContent(infoResponse, "coffee card info");
	const cardInfo = extractCoffeeCardInfo(infoContent);
	const usableQuantity =
		input.usable_quantity ?? extractUsableQuantity(cardInfo) ?? 1;

	const productResponse = await postLuckinJson(fetcher, cardCouponZonePath, auth, {
		deptId: input.deptId,
		supportTakeout: input.supportTakeout,
		couponType: input.coupon_type,
		couponNo: cafeKuId,
	});
	const productContent = extractLuckinContent(productResponse, "coffee card products");
	const products = extractProductList(productContent)
		.map(normalizeLuckinProduct)
		.filter(isNonNullable);

	return {
		cafeKuId,
		cardInfo,
		usableQuantity,
		products,
	};
}

function filterSelectedProducts(
	products: NormalizedLuckinProduct[],
	selectedProducts: Array<{ productId: number; skuCode: string }>,
) {
	const selectedKeys = new Set(
		selectedProducts.map(
			(product) => `${product.productId}:${product.skuCode.trim()}`,
		),
	);

	return products.filter((product) =>
		selectedKeys.has(`${product.productId}:${product.skuCode}`),
	);
}

async function createSellableRowsForCoffeeCard(
	db: D1Database,
	orderUserId: string,
	cafeKuId: string,
	usableQuantity: number,
	products: Array<{ productId: number; skuCode: string }>,
) {
	const safeQuantity = Math.max(0, Math.floor(usableQuantity));

	for (let index = 0; index < safeQuantity; index += 1) {
		await db
			.prepare(
				`INSERT INTO lucky_sellable_products (
					id,
					sellable_product_ids,
					sellable_sku_codes,
					sellable_quantity,
					status,
					order_user_id,
					third_party_remark_id,
					third_party_order_id,
					third_party_product_id,
					is_delete
				)
				VALUES (?, ?, ?, 1, 'waiting', ?, NULL, NULL, ?, 0)`,
			)
			.bind(
				generateId(),
				serializeArray(products.map((product) => String(product.productId))),
				serializeArray(products.map((product) => product.skuCode)),
				orderUserId,
				`coffee-card:${cafeKuId}`,
			)
			.run();
	}

	return safeQuantity;
}

async function postLuckinJson(
	fetcher: typeof fetch,
	path: string,
	auth: ResolvedMiniprogramAuth,
	payload: Record<string, unknown>,
) {
	const url = `${auth.baseUrl}${path}`;
	const body = buildSignedFormBody(payload, auth);
	const headers = buildMiniprogramHeaders(payload, auth);
	logCouponSync("third_party.request", {
		path,
		url,
		method: "POST",
		cid: auth.cid,
		headers: summarizeRequestHeaders(headers),
		payloadBeforeEncrypt: payload,
		formParams: summarizeFormBody(body),
	});

	let response: Response;
	try {
		response = await fetcher(url, {
			method: "POST",
			headers,
			body,
		});
	} catch (error) {
		logCouponSyncError("third_party.request.failed", {
			path,
			url,
			error,
		});
		throw new CoffeeCardSyncError("Luckin miniprogram request failed", 502);
	}

	let rawText: string;
	try {
		rawText = await response.text();
	} catch (error) {
		logCouponSyncError("third_party.response.read_failed", {
			path,
			url,
			status: response.status,
			error,
		});
		throw new CoffeeCardSyncError("Luckin miniprogram request failed", 502);
	}
	logCouponSync("third_party.response.http", {
		path,
		url,
		status: response.status,
		ok: response.ok,
		contentType: response.headers.get("content-type"),
		rawLength: rawText.length,
		rawPrefix: rawText.slice(0, 160),
	});

	if (!response.ok) {
		logCouponSyncError("third_party.response.failed", {
			path,
			url,
			status: response.status,
			contentType: response.headers.get("content-type"),
			rawLength: rawText.length,
			rawPrefix: rawText.slice(0, 240),
		});
		throw new CoffeeCardSyncError("Luckin miniprogram request failed", 502);
	}

	try {
		const parsed = parseLuckinResponseBody(rawText, auth.aesKey);
		logCouponSync("third_party.response", {
			path,
			url,
			code: parsed.code,
			busiCode: parsed.busiCode,
			msg: parsed.msg,
			status: parsed.status,
			responseAfterDecrypt: parsed,
		});
		return parsed;
	} catch (error) {
		logCouponSyncError("third_party.response.invalid", {
			path,
			url,
			error: error instanceof Error ? error.message : String(error),
			rawLength: rawText.length,
			rawPrefix: rawText.slice(0, 240),
		});
		throw new CoffeeCardSyncError("Invalid Luckin miniprogram response", 502);
	}
}

function resolveMiniprogramAuth(
	token: string,
	config: MiniprogramAuthConfig,
): ResolvedMiniprogramAuth {
	const tokenConfig = parseTokenConfig(token);
	const rawCookie = config.cookie ?? tokenConfig.cookie ?? "";
	const uid =
		config.uid ??
		tokenConfig.uid ??
		extractCookieValue(rawCookie, "uid") ??
		defaultMiniprogramUid;
	const aesKey = config.aesKey ?? tokenConfig.aesKey ?? defaultAesKey;
	const cookie = ensureUidCookie(rawCookie, uid);

	return {
		aesKey,
		baseUrl: config.baseUrl ?? tokenConfig.baseUrl ?? miniprogramApiBaseUrl,
		cid: config.cid ?? tokenConfig.cid ?? defaultCid,
		cookie,
		csid: config.csid ?? tokenConfig.csid ?? defaultMiniprogramCsid,
		uid,
		version: config.version ?? tokenConfig.version ?? defaultMiniprogramVersion,
	};
}

function getOrderUserMiniprogramConfig(
	orderUser: OrderUserRow,
): MiniprogramAuthConfig {
	return {
		aesKey: orderUser.aes_key ?? undefined,
		baseUrl: orderUser.base_url ?? undefined,
		cookie: orderUser.cookie ?? undefined,
		csid: orderUser.csid ?? undefined,
		uid: orderUser.uid ?? undefined,
		version: orderUser.miniprogram_version ?? undefined,
	};
}

const emptyMiniprogramAuthConfig = {};

function parseTokenConfig(token: string): MiniprogramAuthConfig {
	try {
		const parsed = JSON.parse(token) as MiniprogramAuthConfig;

		if (parsed && typeof parsed === "object") {
			return parsed;
		}
	} catch {
		return emptyMiniprogramAuthConfig;
	}

	return emptyMiniprogramAuthConfig;
}

function buildSignedFormBody(payload: Record<string, unknown>, auth: ResolvedMiniprogramAuth) {
	const params: Record<string, string> = {
		cid: auth.cid,
		q: encryptPayload(payload, auth.aesKey),
		dk: "1",
	};

	params.sign = signParams(params, auth.aesKey, auth.uid);

	return new URLSearchParams(params).toString();
}

function buildMiniprogramHeaders(
	payload: Record<string, unknown>,
	auth: ResolvedMiniprogramAuth,
) {
	return {
		Accept: "*/*",
		"Content-Type": "application/x-www-form-urlencoded",
		"Accept-Language": "zh-CN,zh;q=0.9",
		"X-LK-MID": defaultMiniprogramMid,
		"X-LK-SID": getRequestSid(payload),
		"X-LK-CSID": auth.csid ?? defaultMiniprogramCsid,
		"X-LK-AKV": defaultMiniprogramAkv,
		"x-lkwx-ostype": "mac",
		"x-lkwx-sdkversion": "3.17.1",
		xweb_xhr: "1",
		"Sec-Fetch-Site": "cross-site",
		"Sec-Fetch-Mode": "cors",
		"Sec-Fetch-Dest": "empty",
		Referer: defaultMiniprogramReferer,
		"User-Agent": defaultMiniprogramUserAgent,
		...(auth.cookie ? { Cookie: auth.cookie } : {}),
	};
}

function summarizeFormBody(body: string) {
	const params = new URLSearchParams(body);
	const q = params.get("q") ?? "";

	return {
		bodyLength: body.length,
		cid: params.get("cid"),
		dk: params.get("dk"),
		sign: params.get("sign"),
		hasUid: params.has("uid"),
		q: {
			length: q.length,
			prefix: q.slice(0, 48),
		},
	};
}

function summarizeRequestHeaders(headers: Record<string, string>) {
	return {
		mid: headers["X-LK-MID"],
		sid: headers["X-LK-SID"],
		csid: headers["X-LK-CSID"],
		akv: headers["X-LK-AKV"],
		ostype: headers["x-lkwx-ostype"],
		sdkversion: headers["x-lkwx-sdkversion"],
		xwebXhr: headers.xweb_xhr,
		acceptLanguage: headers["Accept-Language"],
		secFetchSite: headers["Sec-Fetch-Site"],
		secFetchMode: headers["Sec-Fetch-Mode"],
		secFetchDest: headers["Sec-Fetch-Dest"],
		referer: headers.Referer,
		hasCookie: Boolean(headers.Cookie),
		cookieKeys: headers.Cookie ? getCookieKeys(headers.Cookie) : [],
		cookieHasUid: Boolean(headers.Cookie && extractCookieValue(headers.Cookie, "uid")),
	};
}

function logCouponSync(event: string, data: Record<string, unknown>) {
	appLogger.info("src/controller/lkadmin/couponSync.ts:postLuckinJson", event, data);
}

function logCouponSyncError(event: string, data: Record<string, unknown>) {
	appLogger.error("src/controller/lkadmin/couponSync.ts:postLuckinJson", event, data);
}

function getRequestSid(payload: Record<string, unknown>) {
	return typeof payload.deptId === "number"
		? String(payload.deptId)
		: defaultMiniprogramSid;
}

function ensureUidCookie(cookie: string, uid?: string) {
	if (!uid || extractCookieValue(cookie, "uid")) {
		return cookie;
	}

	return cookie ? `${cookie}; uid=${uid}` : `uid=${uid}`;
}

function encryptPayload(payload: Record<string, unknown>, aesKey: string) {
	return CryptoJS.AES.encrypt(
		JSON.stringify(payload),
		CryptoJS.enc.Utf8.parse(aesKey),
		{
			mode: CryptoJS.mode.ECB,
			padding: CryptoJS.pad.Pkcs7,
		},
	)
		.toString()
		.replace(/\+/g, "-")
		.replace(/\//g, "_");
}

function decryptPayload(q: string, aesKey: string) {
	const decrypted = CryptoJS.AES.decrypt(
		q.replace(/-/g, "+").replace(/_/g, "/"),
		CryptoJS.enc.Utf8.parse(aesKey),
		{
			mode: CryptoJS.mode.ECB,
			padding: CryptoJS.pad.Pkcs7,
		},
	).toString(CryptoJS.enc.Utf8);

	return JSON.parse(decrypted);
}

function parseLuckinResponseBody(rawText: string, aesKey: string): LuckinResponse {
	const trimmed = rawText.trim();
	if (!trimmed) {
		throw new Error("empty response body");
	}

	const parsed = looksLikeJson(trimmed) ? JSON.parse(trimmed) : decryptPayload(trimmed, aesKey);

	if (
		typeof parsed === "string" &&
		(looksLikeJson(parsed.trim()) || parsed.trim().length > 0)
	) {
		return parseLuckinResponseBody(parsed, aesKey);
	}

	return parsed as LuckinResponse;
}

function extractLuckinContent(response: LuckinResponse, step: string) {
	if (response.code !== 1) {
		throw new CoffeeCardSyncError(response.msg || `Luckin ${step} request failed`, 502);
	}

	if (!response.content || !isRecord(response.content)) {
		throw new CoffeeCardSyncError(`Invalid Luckin ${step} response`, 502);
	}

	if (
		"code" in response.content &&
		Number((response.content as { code?: unknown }).code) !== 1 &&
		"isShow" in response.content
	) {
		throw new CoffeeCardSyncError(`Luckin ${step} returned invalid content`, 502);
	}

	return response.content;
}

function signParams(params: Record<string, string>, aesKey: string, uid?: string) {
	const signParams = uid ? { ...params, uid } : params;
	const plain = Object.entries(signParams)
		.filter(([key]) => key !== "sign")
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${value}`)
		.join(";");

	return CryptoJS.MD5(`${plain}${aesKey}`).words
		.map((word) => Math.abs(word).toString())
		.join("");
}

function extractUsableQuantity(value: Record<string, unknown>) {
	const punchCardQuantity = extractQuantityFromText(stringValue(value.punchCardDesc));
	if (punchCardQuantity !== null) {
		return punchCardQuantity;
	}

	const keys = [
		"usableQuantity",
		"availableQuantity",
		"useableQuantity",
		"remainNum",
		"remainCount",
		"remainQuantity",
		"leftNum",
		"leftCount",
		"stockNum",
		"couponNum",
		"count",
		"quantity",
		"balance",
	];

	for (const key of keys) {
		const valueNumber = numberValue(value[key]);
		if (valueNumber !== null && valueNumber >= 0) {
			return Math.floor(valueNumber);
		}
	}

	for (const key of ["stockDesc", "coffeeStockTitle", "cafeKuName", "title", "desc"]) {
		const textQuantity = extractQuantityFromText(stringValue(value[key]));
		if (textQuantity !== null) {
			return textQuantity;
		}
	}

	return null;
}

function extractQuantityFromText(text: string | null) {
	const match = text?.match(/(?:剩余|尚余|还剩)\s*\{?(\d+)\}?\s*(?:张|次|杯)?/);
	return match ? Number(match[1]) : null;
}

function extractCardName(value: Record<string, unknown>) {
	return (
		stringValue(value.coffeeStockTitle) ??
		stringValue(value.cafeKuName) ??
		stringValue(value.couponName) ??
		stringValue(value.name) ??
		stringValue(value.title) ??
		null
	);
}

function parseLinkParams(link: string | null) {
	if (!link) {
		return new URLSearchParams();
	}

	const queryIndex = link.indexOf("?");
	return new URLSearchParams(queryIndex >= 0 ? link.slice(queryIndex + 1) : link);
}

function looksLikeJson(value: string) {
	return value.startsWith("{") || value.startsWith("[");
}

function extractCookieValue(cookie: string, key: string) {
	const targetKey = key.toLowerCase();

	return cookie
		.split(";")
		.map((part) => part.trim())
		.map((part) => {
			const index = part.indexOf("=");

			if (index < 0) {
				return [part, ""] as const;
			}

			return [part.slice(0, index).trim(), part.slice(index + 1)] as const;
		})
		.find(([name]) => name.toLowerCase() === targetKey)?.[1];
}

function getCookieKeys(cookie: string) {
	return cookie
		.split(";")
		.map((part) => part.trim())
		.map((part) => part.slice(0, part.indexOf("=") >= 0 ? part.indexOf("=") : part.length))
		.map((name) => name.trim())
		.filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNonNullable<T>(value: T | null | undefined): value is T {
	return value !== null && value !== undefined;
}

function asRecord(value: unknown) {
	return isRecord(value) ? value : {};
}

function stringValue(value: unknown) {
	return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown) {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}

	return null;
}

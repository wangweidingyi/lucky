import { contentJson, OpenAPIRoute } from "chanfana";
import CryptoJS from "crypto-js";
import { z } from "zod";
import {
	findActiveOrderUser,
	type OrderUserRow,
} from "../../models/LuckyOrderUsers";
import {
	findActiveSellableProduct,
	markSellableProductDone,
	sellableProductIdBodySchema,
} from "../../models/luckySellableProducts";
import { fail, ok } from "../../shared/responses";
import { AppContext } from "../../types";

const miniprogramApiBaseUrl = "https://capi.lkcoffee.com";
const previewPath = "/resource/core/v2/order/preview";
const createPath = "/resource/core/v1/order/create";
const payPath = "/resource/core/v2/pay/topay";
const defaultCid = "230101";
const defaultMiniprogramVersion = "5587";
const defaultMiniprogramAppVersion = 101;
const defaultMiniprogramPayType = "7";
const defaultAesKey = "CJQjAc1hYieC4QYb";
const defaultMiniprogramUid =
	"f931e729-4279-4d30-bdc5-0254af362e551787569733931-2926637-efAmj7k25Su8lEAGHeSrLLDaF7WCSl67RQEGsHnOQYYh3CdepZU4TszMDkSxpjkO";
const defaultMiniprogramOpenid = "ovKu05ATRnvyp7wnI1Sew-MP2U5I";
const defaultMiniprogramBlackBox = "jMPHN1787540409vyeJR3fMRi7";
const defaultMiniprogramNotifyCode =
	"c1.x4g9FHsA0q9qpK_2cw9j_IqsLMDHSHbvkZoZ0UntOnw";
const defaultMiniprogramMid = "2926637";
const defaultMiniprogramSid = "386165";
const defaultMiniprogramCsid = "eb460133-d7de-9d3d-421b-b2054a571373";
const defaultMiniprogramAkv = "lk-wxmp-v5.3.22";
const defaultMiniprogramReferer =
	"https://servicewechat.com/wx21c7506e98a2fe75/929/page-frame.html";
const defaultMiniprogramUserAgent =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Mac MacWechat/WMPF MacWechat/3.8.7(0x13080712) UnifiedPCMacWechat(0xf2641c35) XWEB/25366";
const miniprogramAesKeys = {
	test03: "We18vgcyxPHuz4De",
	test04: "MoOQpner3efXajRk",
	pre: "DzVPFIjpLa8ZQL2l",
	prod: defaultAesKey,
};

const productListItemSchema = z.object({
	amount: z.number().int().positive(),
	productId: z.number().int(),
	skuCode: z.string().min(1),
	checked: z.number().int().optional(),
	eatway: z.string().optional(),
	cafeKuId: z.string().optional(),
	processTypeDetailList: z.array(z.unknown()).optional(),
	name: z.string().optional(),
	discountPrice: z.number().optional(),
	initialPrice: z.number().optional(),
});

export const miniprogramCreateOrderBodySchema =
	sellableProductIdBodySchema.extend({
		deptId: z.number().int(),
		cityId: z.number().int().optional(),
		shopAbTest: z.boolean().optional(),
		productList: z.array(productListItemSchema).min(1),
		longitude: z.number(),
		latitude: z.number(),
		couponCodeList: z.array(z.string()).optional(),
		remark: z.string().optional(),
		wxScene: z.number().int().optional().default(1001),
	});

type MiniprogramCreateOrderInput = z.infer<
	typeof miniprogramCreateOrderBodySchema
>;

type ProductListItem = z.infer<typeof productListItemSchema>;

type LuckinProductDetail = ProductListItem & {
	indexId?: number;
	cafeKuId?: string;
	couponNo?: string;
	coffeeVoucherType?: number;
	processTypeDetailList?: unknown[];
	supportChangeProcessType?: number;
	[key: string]: unknown;
};

type LuckinResponse = {
	code?: number;
	msg?: string;
	busiCode?: string;
	content?: unknown;
	handler?: unknown;
	loginState?: unknown;
	status?: unknown;
	uid?: string;
	version?: unknown;
	zeusId?: string;
	q?: string;
};

type MiniprogramAuthConfig = {
	aesKey?: string;
	baseUrl?: string;
	blackBox?: string;
	cid?: string;
	cookie?: string;
	csid?: string;
	notifyCode?: string;
	openid?: string;
	payType?: number | string;
	uid?: string;
	version?: string;
};

type ResolvedMiniprogramAuth = Required<
	Pick<MiniprogramAuthConfig, "aesKey" | "baseUrl" | "cid" | "version">
> &
	MiniprogramAuthConfig;

export class MiniprogramOrderError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404 | 409 | 502 = 502,
	) {
		super(message);
	}
}

export async function miniprogramCreateOrderForSellableProduct(
	db: D1Database,
	fetcher: typeof fetch,
	input: MiniprogramCreateOrderInput,
	config: MiniprogramAuthConfig = {},
) {
	const sellableProduct = await findActiveSellableProduct(db, input.id);

	if (!sellableProduct) {
		throw new MiniprogramOrderError("Not Found", 404);
	}

	if (sellableProduct.status !== "pending") {
		throw new MiniprogramOrderError("Sellable product is not pending", 409);
	}

	const orderUser = await findActiveOrderUser(db, sellableProduct.order_user_id);

	if (!orderUser) {
		throw new MiniprogramOrderError("Order user not found", 404);
	}

	const auth = resolveMiniprogramAuth(
		orderUser.token,
		mergeMiniprogramConfig(getOrderUserMiniprogramConfig(orderUser), config),
	);
	assertMiniprogramPayAuth(auth);
	const previewPayload = buildPreviewPayload(input, auth.version);
	const previewResponse = await postLuckinJson(
		fetcher,
		previewPath,
		auth,
		previewPayload,
	);
	const preview = extractLuckinContent(previewResponse, "preview");

	assertZeroPayPreview(preview);

	const createPayload = buildCreatePayload(input, preview, auth.version);
	const createResponse = await postLuckinJson(
		fetcher,
		createPath,
		auth,
		createPayload,
	);
	const order = extractLuckinContent(createResponse, "create");
	logMiniprogram("create:result", summarizeCreateResult(order));

	const pay = await completeMiniprogramPayIfNeeded(fetcher, input, auth, order);
	await markSellableProductDone(db, sellableProduct.id, getOrderId(order) || null);

	return pay ? { preview, order, pay } : { preview, order };
}

function buildPreviewPayload(
	input: MiniprogramCreateOrderInput,
	miniprogramVersion: string,
) {
	return {
		shopAbTest: input.shopAbTest ?? true,
		cityId: input.cityId ?? 2,
		scene: 0,
		longitude: input.longitude,
		latitude: input.latitude,
		deptId: input.deptId,
		addressId: "",
		comboList: [],
		productList: input.productList.map(toInitialPreviewProduct),
		delivery: "pick",
		eatway: "package",
		useDiscount: 1,
		useDefaultCafeKu: 1,
		couponCodeList: [],
		isFirst: 1,
		paymentAccountType: 1,
		useCoffeeStore: 1,
		dispatchCouponList: [],
		recommendDispatchCoupon: 1,
		demotionType: 0,
		activityPlanKeysList: [],
		marketingChecked: 0,
		marketingNo: "",
		cardCodeList: [],
		recommendCard: 1,
		limitCouponCodeList: [],
		recommendLimitCoupon: 1,
		payCardChecked: 0,
		payCardNo: "",
		useDiscountType: 2,
		popType: 0,
		privilegeRecommend: { recommendAdditionCoupon: 1 },
		cashCardList: [],
		limitDiscountInfo: null,
		miniversion: miniprogramVersion,
	};
}

function buildCreatePayload(
	input: MiniprogramCreateOrderInput,
	preview: Record<string, unknown>,
	miniprogramVersion: string,
) {
	return {
		shopAbTest: input.shopAbTest ?? true,
		cityId: input.cityId ?? 2,
		scene: 0,
		deptId: input.deptId,
		delivery: "pick",
		eatway: "package",
		addressId: "",
		longitude: input.longitude,
		latitude: input.latitude,
		comboList: [],
		productList: mapCreateProductList(input.productList, preview),
		couponCodeList: getStringArray(preview.couponCodeList),
		limitCouponCodeList: getStringArray(preview.limitCouponCodeList),
		dispatchCouponList: getStringArray(preview.dispatchCouponCodeList),
		cardCodeList: getStringArray(preview.cardCodeList),
		submit: 0,
		submitOf600: 0,
		joinPlan: getArray(preview.joinPlan),
		appVersion: defaultMiniprogramAppVersion,
		giftProductList: [],
		useCoffeeStore: 1,
		dispatchDistance: "",
		paymentAccountType: 1,
		remark: input.remark ?? "",
		needs: [],
		showAgain: 0,
		showMsg: true,
		demotionType: 0,
		marketingChecked: 0,
		marketingNo: "",
		payCardSceneType: 1,
		payCardChecked: 0,
		payCardNo: "",
		cashCardList: [],
		miniversion: miniprogramVersion,
		wxScene: input.wxScene ?? 1001,
	};
}

async function completeMiniprogramPayIfNeeded(
	fetcher: typeof fetch,
	input: MiniprogramCreateOrderInput,
	auth: ResolvedMiniprogramAuth,
	order: Record<string, unknown>,
) {
	if (order.forwardPage !== "pay") {
		return null;
	}

	const payPayload = buildPayPayload(input, auth, order);
	const payResponse = await postLuckinJson(fetcher, payPath, auth, payPayload, {
		sid: String(input.deptId),
	});
	const pay = extractLuckinContent(payResponse, "pay");
	logMiniprogram("pay:result", summarizePayResult(pay));
	assertZeroPayCompletion(pay);

	return pay;
}

function buildPayPayload(
	input: MiniprogramCreateOrderInput,
	auth: ResolvedMiniprogramAuth,
	order: Record<string, unknown>,
) {
	const orderId = getOrderId(order);

	if (!orderId) {
		throw new MiniprogramOrderError("Invalid Luckin create response", 502);
	}

	return {
		blackBox: auth.blackBox ?? "",
		longitude: input.longitude,
		latitude: input.latitude,
		payType: auth.payType ?? defaultMiniprogramPayType,
		busType: 0,
		orderRedeem: order.orderRedeem,
		openid: auth.openid ?? "",
		videoPayment: order.videoPayment,
		notifyCode: auth.notifyCode ?? "",
		orderId,
		miniversion: auth.version,
	};
}

function toInitialPreviewProduct(product: ProductListItem, index: number) {
	const payload: LuckinProductDetail = {
		indexId: index + 1,
		amount: product.amount,
		checked: product.checked ?? 1,
		eatway: product.eatway ?? "both",
		productId: product.productId,
		skuCode: product.skuCode,
		processTypeDetailList: product.processTypeDetailList ?? [],
		cafeKuId: product.cafeKuId ?? "",
	};

	if (product.name) {
		payload.name = product.name;
	}

	if (typeof product.discountPrice === "number") {
		payload.discountPrice = product.discountPrice;
	}

	if (typeof product.initialPrice === "number") {
		payload.initialPrice = product.initialPrice;
	}

	return payload;
}

function mapCreateProductList(
	inputProducts: ProductListItem[],
	preview: Record<string, unknown>,
) {
	const productDetailList = getProductDetailList(preview);

	if (!productDetailList.length) {
		return inputProducts.map(toInitialPreviewProduct);
	}

	return productDetailList.map((product, index) => {
		const fallback = inputProducts[index];

		return {
			indexId: product.indexId ?? index + 1,
			productId: product.productId ?? fallback?.productId,
			skuCode: product.skuCode ?? fallback?.skuCode,
			amount: product.amount ?? fallback?.amount,
			cafeKuId: product.cafeKuId ?? "",
			couponNo: product.couponNo ?? "",
			coffeeVoucherType: product.coffeeVoucherType ?? 0,
			processTypeDetailList: product.processTypeDetailList ?? [],
			supportChangeProcessType: product.supportChangeProcessType ?? 0,
		};
	});
}

async function postLuckinJson(
	fetcher: typeof fetch,
	path: string,
	auth: ResolvedMiniprogramAuth,
	payload: Record<string, unknown>,
	options: { sid?: string } = {},
) {
	const url = `${auth.baseUrl}${path}`;
	const body = buildSignedFormBody(payload, auth);
	const headers = buildMiniprogramHeaders(payload, auth, options);
	logMiniprogram("request:start", {
		path,
		url,
		cid: auth.cid,
		hasCookie: Boolean(auth.cookie),
		cookieHasUid: Boolean(auth.cookie && extractCookieValue(auth.cookie, "uid")),
		headers: summarizeRequestHeaders(headers),
		payload: sanitizeMiniprogramLogValue(payload),
		form: summarizeFormBody(body),
	});

	const response = await fetcher(url, {
		method: "POST",
		headers,
		body,
	});
	const rawText = await response.text();

	logMiniprogram("response:http", {
		path,
		status: response.status,
		ok: response.ok,
		contentType: response.headers.get("content-type"),
		contentEncoding: response.headers.get("content-encoding"),
		zeusId: response.headers.get("x-zeus-msg-id"),
		rawLength: rawText.length,
		rawPrefix: rawText.slice(0, 160),
	});

	if (!response.ok) {
		throw new MiniprogramOrderError("Luckin miniprogram request failed", 502);
	}

	try {
		const parsed = parseLuckinResponseBody(
			rawText,
			response.headers.get("content-type"),
			auth.aesKey,
			path,
		);
		logMiniprogram("response:parsed", {
			path,
			code: parsed.code,
			busiCode: parsed.busiCode,
			msg: parsed.msg,
			status: parsed.status,
			loginState: parsed.loginState,
			version: parsed.version,
			handler: sanitizeMiniprogramLogValue(parsed.handler),
			hasContent: Boolean(parsed.content),
			content: parsed.code === 1 ? "[success-content]" : sanitizeMiniprogramLogValue(parsed.content),
			uid: parsed.uid ? "[present]" : "",
			zeusId: parsed.zeusId,
		});
		return parsed;
	} catch (error) {
		logMiniprogram("response:invalid", {
			path,
			error: error instanceof Error ? error.message : String(error),
			contentType: response.headers.get("content-type"),
			rawLength: rawText.length,
			rawPrefix: rawText.slice(0, 240),
			decryptProbe: probeKnownAesKeys(rawText),
		});
		throw new MiniprogramOrderError("Invalid Luckin miniprogram response", 502);
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
	const version = config.version ?? tokenConfig.version ?? defaultMiniprogramVersion;
	const blackBox =
		config.blackBox ?? tokenConfig.blackBox ?? defaultMiniprogramBlackBox;
	const csid = config.csid ?? tokenConfig.csid ?? defaultMiniprogramCsid;
	const notifyCode =
		config.notifyCode ?? tokenConfig.notifyCode ?? defaultMiniprogramNotifyCode;
	const openid = config.openid ?? tokenConfig.openid ?? defaultMiniprogramOpenid;
	const payType = config.payType ?? tokenConfig.payType ?? defaultMiniprogramPayType;
	logMiniprogram("auth:resolved", {
		tokenIsJson: tokenConfig !== emptyMiniprogramAuthConfig,
		hasTokenUid: Boolean(tokenConfig.uid),
		hasConfigUid: Boolean(config.uid),
		hasOpenid: Boolean(openid),
		hasBlackBox: Boolean(blackBox),
		hasNotifyCode: Boolean(notifyCode),
		resolvedUid: uid ? "[present]" : "",
		rawCookieLength: rawCookie.length,
		cookieLength: cookie.length,
		rawCookieKeys: getCookieKeys(rawCookie),
		cookieKeys: getCookieKeys(cookie),
		cookieHasUid: Boolean(extractCookieValue(cookie, "uid")),
		aesKeyName: getKnownAesKeyName(aesKey),
		version,
	});

	return {
		aesKey,
		baseUrl: config.baseUrl ?? tokenConfig.baseUrl ?? miniprogramApiBaseUrl,
		cid: config.cid ?? tokenConfig.cid ?? defaultCid,
		blackBox,
		cookie,
		csid,
		notifyCode,
		openid,
		payType,
		uid,
		version,
	};
}

function getOrderUserMiniprogramConfig(
	orderUser: OrderUserRow,
): MiniprogramAuthConfig {
	return {
		aesKey: orderUser.aes_key ?? undefined,
		baseUrl: orderUser.base_url ?? undefined,
		blackBox: orderUser.black_box ?? undefined,
		cookie: orderUser.cookie ?? undefined,
		csid: orderUser.csid ?? undefined,
		notifyCode: orderUser.notify_code ?? undefined,
		openid: orderUser.openid ?? undefined,
		payType: orderUser.pay_type ?? undefined,
		uid: orderUser.uid ?? undefined,
		version: orderUser.miniprogram_version ?? undefined,
	};
}

function mergeMiniprogramConfig(
	...configs: MiniprogramAuthConfig[]
): MiniprogramAuthConfig {
	const merged: Record<string, unknown> = {};

	for (const config of configs) {
		for (const [key, value] of Object.entries(config)) {
			if (value !== undefined) {
				merged[key] = value;
			}
		}
	}

	return merged as MiniprogramAuthConfig;
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

function buildSignedFormBody(
	payload: Record<string, unknown>,
	auth: Required<Pick<MiniprogramAuthConfig, "aesKey" | "cid">> &
		MiniprogramAuthConfig,
) {
	const params: Record<string, string> = {
		cid: auth.cid,
		q: encryptPayload(payload, auth.aesKey),
		dk: "1",
	};

	params.sign = signParams(params, auth.aesKey, auth.uid);

	return new URLSearchParams(params).toString();
}

function summarizeFormBody(body: string) {
	const params = new URLSearchParams(body);
	const q = params.get("q") ?? "";

	return {
		bodyLength: body.length,
		bodyPrefix: body.slice(0, 80),
		cid: params.get("cid"),
		dk: params.get("dk"),
		sign: params.get("sign"),
		hasUid: params.has("uid"),
		qLength: q.length,
		qPrefix: q.slice(0, 48),
	};
}

function buildMiniprogramHeaders(
	payload: Record<string, unknown>,
	auth: ResolvedMiniprogramAuth,
	options: { sid?: string } = {},
) {
	return {
		Accept: "*/*",
		"Content-Type": "application/x-www-form-urlencoded",
		"Accept-Language": "zh-CN,zh;q=0.9",
		"X-LK-MID": defaultMiniprogramMid,
		"X-LK-SID": options.sid ?? getRequestSid(payload),
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

function probeKnownAesKeys(q: string) {
	return Object.entries(miniprogramAesKeys).map(([name, aesKey]) => {
		try {
			const decrypted = CryptoJS.AES.decrypt(
				q.trim().replace(/-/g, "+").replace(/_/g, "/"),
				CryptoJS.enc.Utf8.parse(aesKey),
				{
					mode: CryptoJS.mode.ECB,
					padding: CryptoJS.pad.Pkcs7,
				},
			).toString(CryptoJS.enc.Utf8);

			return {
				name,
				ok: Boolean(decrypted),
				length: decrypted.length,
				prefix: decrypted.slice(0, 80),
			};
		} catch (error) {
			return {
				name,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});
}

function parseLuckinResponseBody(
	rawText: string,
	contentType: string | null,
	aesKey: string,
	path: string,
) {
	const trimmed = rawText.trim();

	if (!trimmed) {
		throw new Error("empty response body");
	}

	logMiniprogram("response:body", {
		path,
		contentType,
		bodyKind: looksLikeJson(trimmed) ? "json" : "encrypted-text",
		bodyLength: trimmed.length,
	});

	if (looksLikeJson(trimmed)) {
		return parseLuckinResponse(JSON.parse(trimmed), aesKey, path);
	}

	return decryptLuckinResponseText(trimmed, aesKey, path);
}

function decryptLuckinResponseText(q: string, aesKey: string, path: string) {
	logMiniprogram("response:decrypt:start", {
		path,
		qLength: q.length,
		qPrefix: q.slice(0, 48),
	});
	const decrypted = decryptPayload(q, aesKey);
	logMiniprogram("response:decrypt:success", {
		path,
		keys: decrypted && typeof decrypted === "object" ? Object.keys(decrypted) : [],
	});

	return decrypted as LuckinResponse;
}

function signParams(
	params: Record<string, string>,
	aesKey: string,
	uid?: string,
) {
	const signParams = uid ? { ...params, uid } : params;
	const plain = Object.entries(signParams)
		.filter(([key]) => key !== "sign")
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${value}`)
		.join(";");

	return luckinMd5(`${plain}${aesKey}`);
}

function luckinMd5(value: string) {
	const words = CryptoJS.MD5(value).words;

	if (words.length !== 4) {
		throw new MiniprogramOrderError("Invalid Luckin sign result", 502);
	}

	return words.map((word) => Math.abs(word).toString()).join("");
}

function parseLuckinResponse(
	payload: unknown,
	aesKey: string,
	path: string,
): LuckinResponse {
	if (typeof payload === "string") {
		const trimmed = payload.trim();

		if (looksLikeJson(trimmed)) {
			return parseLuckinResponse(JSON.parse(trimmed), aesKey, path);
		}

		return decryptLuckinResponseText(trimmed, aesKey, path);
	}

	if (
		payload &&
		typeof payload === "object" &&
		"q" in payload &&
		typeof (payload as LuckinResponse).q === "string"
	) {
		return decryptLuckinResponseText((payload as LuckinResponse).q as string, aesKey, path);
	}

	return payload as LuckinResponse;
}

function looksLikeJson(value: string) {
	return value.startsWith("{") || value.startsWith("[");
}

function logMiniprogram(step: string, data: Record<string, unknown>) {
	console.log(`[miniprogramCreateOrder] ${step}`, JSON.stringify(data));
}

function sanitizeMiniprogramLogValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sanitizeMiniprogramLogValue);
	}

	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([key, item]) => [
				key,
				key.toLowerCase() === "uid"
					? item
						? "[present]"
						: ""
					: sanitizeMiniprogramLogValue(item),
			]),
		);
	}

	return value;
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

function getKnownAesKeyName(aesKey: string) {
	return (
		Object.entries(miniprogramAesKeys).find(([, value]) => value === aesKey)?.[0] ??
		"custom"
	);
}

function extractLuckinContent(response: LuckinResponse, step: "preview" | "create" | "pay") {
	if (response.code !== 1) {
		throw new MiniprogramOrderError(
			response.msg || `Luckin ${step} request failed`,
			502,
		);
	}

	if (!response.content || typeof response.content !== "object") {
		throw new MiniprogramOrderError(
			`Invalid Luckin ${step} response`,
			502,
		);
	}

	return response.content as Record<string, unknown>;
}

function assertZeroPayPreview(preview: Record<string, unknown>) {
	const discountPrice = Number(preview.discountPrice ?? 0);

	if (Number.isFinite(discountPrice) && discountPrice !== 0) {
		throw new MiniprogramOrderError(
			`Preview payable amount is ${discountPrice}, skip create order`,
			409,
		);
	}
}

function assertMiniprogramPayAuth(auth: ResolvedMiniprogramAuth) {
	if (!auth.openid) {
		throw new MiniprogramOrderError(
			"Luckin miniprogram openid is required",
			409,
		);
	}
}

function assertZeroPayCompletion(pay: Record<string, unknown>) {
	if (Number(pay.payStatus) === 2) {
		throw new MiniprogramOrderError(
			String(pay.desc || "Luckin miniprogram payment failed"),
			409,
		);
	}

	if (pay.needPay === true) {
		throw new MiniprogramOrderError(
			"Luckin miniprogram order still requires payment",
			409,
		);
	}
}

function getProductDetailList(preview: Record<string, unknown>) {
	const value = Array.isArray(preview.productDetailList)
		? preview.productDetailList
		: preview.priceList;

	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter(
		(product): product is LuckinProductDetail =>
			!!product && typeof product === "object",
	);
}

function getStringArray(value: unknown, fallback: unknown = []) {
	if (!Array.isArray(value)) {
		return Array.isArray(fallback) ? fallback.filter(isString) : [];
	}

	return value.filter(isString);
}

function getArray(value: unknown) {
	return Array.isArray(value) ? value : [];
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function summarizeCreateResult(order: Record<string, unknown>) {
	return {
		orderId: order.orderId ? "[present]" : "",
		orderIdStr: order.orderIdStr ? "[present]" : "",
		orderChild: order.orderChild,
		forwardPage: order.forwardPage,
		payType: order.payType,
		payInfo: order.payInfo ? "[present]" : "",
	};
}

function summarizePayResult(pay: Record<string, unknown>) {
	return {
		payStatus: pay.payStatus,
		needPay: pay.needPay,
		desc: pay.desc,
		hasPayParams: Boolean(pay.payParams),
	};
}

function getOrderId(order: Record<string, unknown>) {
	const orderId = order.orderId ?? order.orderIdStr;

	return typeof orderId === "string" || typeof orderId === "number"
		? String(orderId)
		: "";
}

export class MiniprogramCreateOrder extends OpenAPIRoute {
	schema = {
		tags: ["Orders"],
		summary:
			"Preview then create a Luckin miniprogram zero-pay order with coffee card auto-selection",
		request: {
			body: contentJson(miniprogramCreateOrderBodySchema),
		},
		responses: {
			"200": {
				description: "Miniprogram order preview and creation result",
				...contentJson(z.unknown()),
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();

		try {
			return ok(
				c,
				await miniprogramCreateOrderForSellableProduct(
					c.env.DB,
					fetch,
					data.body,
					getEnvMiniprogramConfig(c.env),
				),
			);
		} catch (error) {
			if (error instanceof MiniprogramOrderError) {
				return fail(c, error.message, error.status);
			}

			throw error;
		}
	}
}

function getEnvMiniprogramConfig(env: Env): MiniprogramAuthConfig {
	const values = env as unknown as Record<string, string | undefined>;

	return {
		aesKey: values.LUCKIN_MINIPROGRAM_AES_KEY,
		baseUrl: values.LUCKIN_MINIPROGRAM_BASE_URL,
		blackBox: values.LUCKIN_MINIPROGRAM_BLACK_BOX,
		cid: values.LUCKIN_MINIPROGRAM_CID,
		csid: values.LUCKIN_MINIPROGRAM_CSID,
		notifyCode: values.LUCKIN_MINIPROGRAM_NOTIFY_CODE,
		openid: values.LUCKIN_MINIPROGRAM_OPENID,
		payType: values.LUCKIN_MINIPROGRAM_PAY_TYPE,
		version: values.LUCKIN_MINIPROGRAM_VERSION,
	};
}

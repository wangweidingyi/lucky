import CryptoJS from "crypto-js";
import { appLogger } from "../../shared/logger";
import type { MiniprogramOrderUserRow } from "../../models/miniprogramOrderUsers";

export const miniprogramApiBaseUrl = "https://capi.lkcoffee.com";
export const coffeeCardListPath = "/resource/m/promotion/v2/myself/list";
export const cardCouponZonePath = "/resource/core/v3/product/cardCouponZone";
export const productDetailPath = "/resource/core/v2/product/detail";
export const productPriceCalcPath = "/resource/core/v2/product/priceCalc";
export const shopListPath = "/resource/m/shop/shopList";
export const shopSearchPath = "/resource/m/shop/list";
export const previewPath = "/resource/core/v2/order/preview";
export const coffeeStoreMatchPath = "/resource/core/v2/order/coffeestore/match";
export const preCreatePath = "/resource/core/v1/order/preCreate";
export const createPath = "/resource/core/v1/order/create";
export const payPath = "/resource/core/v2/pay/topay";
export const orderDetailPath = "/resource/core/v1/order/detail";
export const takeCodePath = "/resource/core/v1/order/getTakeCodeInfo";

const defaultCid = "230101";
const defaultMiniprogramMid = "2926637";
const defaultMiniprogramSid = "386165";
const defaultMiniprogramCsid = "eb460133-d7de-9d3d-421b-b2054a571373";
const defaultMiniprogramAkv = "lk-wxmp-v5.3.22";
const defaultMiniprogramReferer =
  "https://servicewechat.com/wx21c7506e98a2fe75/929/page-frame.html";
const defaultMiniprogramUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Mac MacWechat/WMPF MacWechat/3.8.7(0x13080712) UnifiedPCMacWechat(0xf2641c35) XWEB/25366";

export type MiniprogramAuth = {
  aesKey: string;
  baseUrl: string;
  cid: string;
  cookie: string;
  csid?: string | null;
  uid: string;
  openid?: string | null;
  blackBox?: string | null;
  deviceId?: string | null;
  notifyCode?: string | null;
  payType?: string | null;
  version: string;
};

export type LuckinResponse = {
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

export class MiniprogramClientError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502 = 502,
  ) {
    super(message);
  }
}

export function authFromMiniprogramOrderUser(
  orderUser: MiniprogramOrderUserRow,
  overrides: Partial<MiniprogramAuth> = {},
): MiniprogramAuth {
  const uid = overrides.uid ?? orderUser.uid;
  const cookie = ensureUidCookie(
    overrides.cookie ?? orderUser.cookie ?? "",
    uid,
  );

  return {
    aesKey: overrides.aesKey ?? orderUser.aes_key,
    baseUrl: overrides.baseUrl ?? orderUser.base_url ?? miniprogramApiBaseUrl,
    cid: overrides.cid ?? defaultCid,
    cookie,
    csid: overrides.csid ?? orderUser.csid,
    uid,
    openid: overrides.openid ?? orderUser.openid,
    blackBox: overrides.blackBox ?? orderUser.black_box,
    deviceId:
      overrides.deviceId ??
      ("device_id" in orderUser
        ? (orderUser as MiniprogramOrderUserRow & { device_id?: string | null })
            .device_id
        : null),
    notifyCode: overrides.notifyCode ?? orderUser.notify_code,
    payType: overrides.payType ?? orderUser.pay_type,
    version: overrides.version ?? orderUser.miniprogram_version,
  };
}

export async function postLuckinJson(
  fetcher: typeof fetch,
  path: string,
  auth: MiniprogramAuth,
  payload: Record<string, unknown>,
  options: { sid?: string } = {},
) {
  const url = `${auth.baseUrl}${path}`;
  const body = buildSignedFormBody(payload, auth);
  const headers = buildMiniprogramHeaders(payload, auth, options);

  logMiniprogram("third_party.request", {
    path,
    url,
    method: "POST",
    cid: auth.cid,
    hasCookie: Boolean(auth.cookie),
    cookieHasUid: Boolean(extractCookieValue(auth.cookie, "uid")),
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
    logMiniprogramError("third_party.request.failed", { path, url, error });
    throw new MiniprogramClientError("Luckin miniprogram request failed", 502);
  }

  const rawText = await response.text();
  logMiniprogram("third_party.response.http", {
    path,
    url,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get("content-type"),
    zeusId: response.headers.get("x-zeus-msg-id"),
    rawLength: rawText.length,
    rawPrefix: rawText.slice(0, 160),
  });

  if (!response.ok) {
    throw new MiniprogramClientError("Luckin miniprogram request failed", 502);
  }

  try {
    const parsed = parseLuckinResponseBody(
      rawText,
      response.headers.get("content-type"),
      auth.aesKey,
      path,
    );
    logMiniprogram("third_party.response", {
      path,
      code: parsed.code,
      busiCode: parsed.busiCode,
      msg: parsed.msg,
      status: parsed.status,
      loginState: parsed.loginState,
      handler: parsed.handler,
      hasContent: Boolean(parsed.content),
      uid: parsed.uid ? "[present]" : "",
      zeusId: parsed.zeusId,
    });
    return parsed;
  } catch (error) {
    logMiniprogramError("third_party.response.invalid", {
      path,
      error: error instanceof Error ? error.message : String(error),
      rawLength: rawText.length,
      rawPrefix: rawText.slice(0, 240),
    });
    throw new MiniprogramClientError(
      "Invalid Luckin miniprogram response",
      502,
    );
  }
}

export function extractLuckinContent(response: LuckinResponse, step: string) {
  if (response.code !== 1) {
    logMiniprogramError("third_party.business_error", {
      step,
      code: response.code,
      busiCode: response.busiCode,
      msg: response.msg,
      status: response.status,
      handler: response.handler,
      loginState: response.loginState,
      zeusId: response.zeusId,
      content: summarizeBusinessContent(response.content),
    });
    throw new MiniprogramClientError(
      response.msg || `Luckin ${step} request failed`,
      502,
    );
  }

  if (!response.content || typeof response.content !== "object") {
    throw new MiniprogramClientError(`Invalid Luckin ${step} response`, 502);
  }

  return response.content as Record<string, unknown>;
}

function buildSignedFormBody(
  payload: Record<string, unknown>,
  auth: MiniprogramAuth,
) {
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
  auth: MiniprogramAuth,
  options: { sid?: string },
) {
  return {
    Accept: "*/*",
    "Content-Type": "application/x-www-form-urlencoded",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "X-LK-MID": defaultMiniprogramMid,
    "X-LK-SID": options.sid ?? getRequestSid(payload),
    "X-LK-CSID": auth.csid || defaultMiniprogramCsid,
    "X-LK-AKV": defaultMiniprogramAkv,
    "x-lkwx-ostype": "mac",
    "x-lkwx-sdkversion": "3.17.1",
    xweb_xhr: "1",
    "Sec-Fetch-Site": "cross-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    Referer: defaultMiniprogramReferer,
    "User-Agent": defaultMiniprogramUserAgent,
    Cookie: auth.cookie,
  };
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

  return JSON.parse(decrypted) as LuckinResponse;
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

  logMiniprogram("response.body", {
    path,
    contentType,
    bodyKind: looksLikeJson(trimmed) ? "json" : "encrypted-text",
    bodyLength: trimmed.length,
  });

  if (looksLikeJson(trimmed)) {
    return parseLuckinResponse(JSON.parse(trimmed), aesKey);
  }

  return decryptPayload(trimmed, aesKey);
}

function parseLuckinResponse(payload: unknown, aesKey: string): LuckinResponse {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    return looksLikeJson(trimmed)
      ? parseLuckinResponse(JSON.parse(trimmed), aesKey)
      : decryptPayload(trimmed, aesKey);
  }

  if (
    payload &&
    typeof payload === "object" &&
    "q" in payload &&
    typeof (payload as LuckinResponse).q === "string"
  ) {
    return decryptPayload((payload as LuckinResponse).q as string, aesKey);
  }

  return payload as LuckinResponse;
}

function looksLikeJson(value: string) {
  return value.startsWith("{") || value.startsWith("[");
}

function signParams(
  params: Record<string, string>,
  aesKey: string,
  uid: string,
) {
  const plain = Object.entries({ ...params, uid })
    .filter(([key]) => key !== "sign")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(";");

  return CryptoJS.MD5(`${plain}${aesKey}`)
    .words.map((word) => Math.abs(word).toString())
    .join("");
}

function ensureUidCookie(cookie: string, uid: string) {
  if (extractCookieValue(cookie, "uid")) {
    return cookie;
  }

  return cookie ? `${cookie}; uid=${uid}` : `uid=${uid}`;
}

function extractCookieValue(cookie: string, key: string) {
  const targetKey = key.toLowerCase();

  return cookie
    .split(";")
    .map((part) => part.trim())
    .map((part) => {
      const index = part.indexOf("=");
      return index < 0
        ? ([part, ""] as const)
        : ([part.slice(0, index).trim(), part.slice(index + 1)] as const);
    })
    .find(([name]) => name.toLowerCase() === targetKey)?.[1];
}

function getCookieKeys(cookie: string) {
  return cookie
    .split(";")
    .map((part) => part.trim())
    .map((part) =>
      part.slice(0, part.indexOf("=") >= 0 ? part.indexOf("=") : part.length),
    )
    .map((name) => name.trim())
    .filter(Boolean);
}

function getRequestSid(payload: Record<string, unknown>) {
  return typeof payload.deptId === "number"
    ? String(payload.deptId)
    : defaultMiniprogramSid;
}

function summarizeFormBody(body: string) {
  const params = new URLSearchParams(body);
  const q = params.get("q") ?? "";

  return {
    bodyLength: body.length,
    cid: params.get("cid"),
    dk: params.get("dk"),
    sign: params.get("sign"),
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
    referer: headers.Referer,
    cookieKeys: getCookieKeys(headers.Cookie),
    cookieHasUid: Boolean(extractCookieValue(headers.Cookie, "uid")),
  };
}

function summarizeBusinessContent(content: unknown) {
  if (!content || typeof content !== "object") {
    return content ?? null;
  }

  if (Array.isArray(content)) {
    return { type: "array", length: content.length };
  }

  const record = content as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) =>
        [
          "code",
          "msg",
          "message",
          "desc",
          "errorMsg",
          "status",
          "handler",
          "busiCode",
        ].includes(key),
      )
      .slice(0, 12),
  );
}

function logMiniprogram(step: string, data: Record<string, unknown>) {
  appLogger.info("src/controller/miniprogramorder", step, data);
}

function logMiniprogramError(step: string, data: Record<string, unknown>) {
  appLogger.error("src/controller/miniprogramorder", step, data);
}

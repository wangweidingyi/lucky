import { fromHono } from "chanfana";
import { Hono } from "hono";
import { z } from "zod";
import {
  deserializeMiniprogramCoffeeCard,
  upsertMiniprogramCoffeeCard,
  type MiniprogramCoffeeCardRow,
} from "../../models/miniprogramCoffeeCards";
import {
  findActiveMiniprogramOrderUser,
  miniprogramIdSchema,
} from "../../models/miniprogramOrderUsers";
import {
  deserializeMiniprogramSellable,
  findActiveMiniprogramSellableWithCard,
  markMiniprogramSellableDone,
  miniprogramSellableIdBodySchema,
} from "../../models/miniprogramSellableProducts";
import {
  generateMiniprogramSellableId,
  generateMiniprogramSellableSign,
} from "../../shared/id";
import { fail, ok } from "../../shared/responses";
import type { AppContext } from "../../types";
import {
  authFromMiniprogramOrderUser,
  cardCouponZonePath,
  coffeeCardListPath,
  coffeeStoreMatchPath,
  createPath,
  extractLuckinContent,
  getLuckinJson,
  MiniprogramClientError,
  openingCitysPath,
  orderDetailPath,
  payPath,
  postLuckinJson,
  preCreatePath,
  previewPath,
  productDetailPath,
  productPriceCalcPath,
  shopListPath,
  shopSearchPath,
  takeCodePath,
  type MiniprogramAuth,
} from "./miniprogramClient";

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

const syncCoffeeCardsBodySchema = z.object({
  orderUserId: miniprogramIdSchema,
});

const cardProductsBodySchema = miniprogramSellableIdBodySchema.extend({
  deptId: z.number().int().positive(),
  supportTakeout: z.number().int().min(0).max(1).optional().default(0),
});

const productDetailBodySchema = miniprogramSellableIdBodySchema.extend({
  deptId: z.number().int().positive(),
  productId: z.number().int().positive(),
  skuCode: z.string().optional().default(""),
  supportTakeout: z.number().int().min(0).max(1).optional().default(0),
  position: z.number().int().nonnegative().optional().default(0),
  processTypeDetailList: z.array(jsonValueSchema).optional().default([]),
  planNumber: z.union([z.string(), z.number()]).optional().default(""),
  discountSchemeNo: z.union([z.string(), z.number()]).optional().default(""),
  classifyIndex: z.union([z.string(), z.number()]).optional().default(""),
  benefitNo: z.union([z.string(), z.number()]).optional().default(""),
});

const productAttributeSwitchBodySchema = productDetailBodySchema.extend({
  skuCode: z.string().min(1),
  amount: z.number().int().positive().optional().default(1),
  group: z.union([z.string(), z.number()]).optional().default(""),
  attrOperationParam: z.record(jsonValueSchema),
});

const shopQueryBodySchema = miniprogramSellableIdBodySchema.extend({
  longitude: z.number(),
  latitude: z.number(),
  cityId: z.union([z.number().int(), z.string()]).optional().default(""),
  deptName: z.string().optional(),
  offSet: z.number().int().nonnegative().optional().default(0),
  pageSize: z.number().int().positive().max(50).optional().default(10),
});

const selectedProductSchema = z
  .object({
    productId: z.number().int().positive(),
    skuCode: z.string().min(1),
    productName: z.string().min(1).optional(),
    amount: z.number().int().positive().optional().default(1),
    processTypeDetailList: z.array(jsonValueSchema).optional().default([]),
  })
  .passthrough();

const createOrderBodySchema = miniprogramSellableIdBodySchema.extend({
  deptId: z.number().int().positive(),
  cityId: z.number().int().optional().default(2),
  longitude: z.number(),
  latitude: z.number(),
  remark: z.string().optional().default(""),
  product: selectedProductSchema,
  wxScene: z.number().int().optional().default(1001),
});

const orderDetailBodySchema = miniprogramSellableIdBodySchema.extend({
  orderId: z.string().min(1).optional(),
});

type SyncCoffeeCardsInput = z.infer<typeof syncCoffeeCardsBodySchema>;
type CardProductsInput = z.infer<typeof cardProductsBodySchema>;
type ProductDetailInput = z.infer<typeof productDetailBodySchema>;
type ProductAttributeSwitchInput = z.infer<
  typeof productAttributeSwitchBodySchema
>;
type CitiesInput = z.infer<typeof miniprogramSellableIdBodySchema>;
type ShopQueryInput = z.infer<typeof shopQueryBodySchema>;
type CreateOrderInput = z.infer<typeof createOrderBodySchema>;
type OrderDetailInput = z.infer<typeof orderDetailBodySchema>;

const generateSellablesBodySchema = z.object({
  id: z.number().int().positive(),
  force: z.boolean().optional().default(false),
});

type GenerateSellablesInput = z.infer<typeof generateSellablesBodySchema>;

export class MiniprogramOrderError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 502 = 502,
  ) {
    super(message);
  }
}

export async function syncMiniprogramCoffeeCards(
  db: D1Database,
  fetcher: typeof fetch,
  input: SyncCoffeeCardsInput,
) {
  const body = syncCoffeeCardsBodySchema.parse(input);
  const orderUser = await getMiniprogramOrderUserOrThrow(db, body.orderUserId);
  const auth = authFromMiniprogramOrderUser(orderUser);
  const response = await postLuckinJson(fetcher, coffeeCardListPath, auth, {
    miniversion: auth.version,
  });
  const content = extractLuckinContent(response, "coffee card list");
  const rawCards = extractCoffeeCards(content);
  const cards: MiniprogramCoffeeCardRow[] = [];
  let generatedSellableCount = 0;

  for (const raw of rawCards) {
    const normalized = normalizeCoffeeCard(body.orderUserId, raw);
    if (!normalized) {
      continue;
    }

    const card = await upsertMiniprogramCoffeeCard(db, normalized);
    if (!card) {
      continue;
    }

    const generatedCount = await countActiveSellablesForCard(db, card.id);
    await db
      .prepare(
        `UPDATE miniprogram_coffee_cards
				 SET generated_sellable_count = ?
				 WHERE id = ? AND is_delete = 0`,
      )
      .bind(generatedCount, card.id)
      .run();
    const nextCard = await getMiniprogramCoffeeCardById(db, card.id);
    if (nextCard) {
      cards.push(nextCard);
    }
    generatedSellableCount += generatedCount;
  }

  return {
    cards,
    syncedCount: cards.length,
    rawCount: rawCards.length,
    generatedSellableCount,
  };
}

export async function generateMiniprogramSellablesForCard(
  db: D1Database,
  input: GenerateSellablesInput,
) {
  const body = generateSellablesBodySchema.parse(input);
  const card = await getMiniprogramCoffeeCardById(db, body.id);
  if (!card) {
    throw new MiniprogramOrderError("Coffee card not found", 404);
  }

  const usableQuantity = Math.max(0, Math.floor(card.usableQuantity));
  let activeSellables = await listActiveSellablesForCard(db, card.id);
  const activeSellableCount = activeSellables.length;

  if (activeSellableCount === usableQuantity && !body.force) {
    const nextCard = await updateCardGeneratedSellableCount(
      db,
      card.id,
      activeSellableCount,
    );

    return {
      card: nextCard ?? card,
      sellables: activeSellables,
      usableQuantity,
      activeSellableCount,
      regenerated: false,
    };
  }

  if (activeSellableCount > usableQuantity) {
    const overflow = activeSellableCount - usableQuantity;
    const deletedCount = await deleteWaitingSellablesForCard(
      db,
      card.id,
      overflow,
    );

    activeSellables = await listActiveSellablesForCard(db, card.id);
    if (activeSellables.length > usableQuantity) {
      throw new MiniprogramOrderError(
        `可售记录数量不一致：卡券剩余 ${usableQuantity}，当前活跃库存 ${activeSellables.length}，其中 ${overflow - deletedCount} 条无法自动删除`,
        409,
      );
    }
  }

  if (activeSellables.length < usableQuantity) {
    const needCreate = usableQuantity - activeSellables.length;
    for (let index = 0; index < needCreate; index += 1) {
      await insertSellableForCard(db, card);
    }
  }

  if (body.force && activeSellables.length > usableQuantity) {
    throw new MiniprogramOrderError(
      `可售记录数量不一致：卡券剩余 ${usableQuantity}，当前活跃库存 ${activeSellables.length}`,
      409,
    );
  }

  const sellables = await listActiveSellablesForCard(db, card.id);
  const nextCard = await updateCardGeneratedSellableCount(
    db,
    card.id,
    sellables.length,
  );

  return {
    card: nextCard ?? card,
    sellables,
    usableQuantity,
    activeSellableCount: sellables.length,
    regenerated: sellables.length !== activeSellableCount,
  };
}

export async function fetchMiniprogramCardProductsForSellable(
  db: D1Database,
  fetcher: typeof fetch,
  input: CardProductsInput,
) {
  const body = cardProductsBodySchema.parse(input);
  const context = await getSellableContextOrThrow(db, body.id, body.sign);
  const orderUser = await getMiniprogramOrderUserOrThrow(
    db,
    context.orderUserId,
  );
  const auth = authFromMiniprogramOrderUser(orderUser);
  const response = await postLuckinJson(fetcher, cardCouponZonePath, auth, {
    deptId: body.deptId,
    supportTakeout: body.supportTakeout,
    couponType: context.coffeeCard.couponType || 2,
    couponNo: couponNoForCard(context.coffeeCard),
  });
  const content = extractLuckinContent(response, "coffee card products");
  const products = extractProductList(content)
    .map(normalizeLuckinProduct)
    .filter(isNonNullable);

  return {
    sellable: context,
    products,
    productCount: products.length,
  };
}

export async function fetchMiniprogramProductDetailForSellable(
  db: D1Database,
  fetcher: typeof fetch,
  input: ProductDetailInput,
) {
  const body = productDetailBodySchema.parse(input);
  const context = await getSellableContextOrThrow(db, body.id, body.sign);
  const orderUser = await getMiniprogramOrderUserOrThrow(
    db,
    context.orderUserId,
  );
  const auth = authFromMiniprogramOrderUser(orderUser);
  const response = await postLuckinJson(
    fetcher,
    productDetailPath,
    auth,
    buildProductDetailPayload(body, context.coffeeCard),
    { sid: String(body.deptId) },
  );
  const content = extractLuckinContent(response, "product detail");

  return {
    sellable: context,
    product: normalizeLuckinProductWithFallback(content, {
      productId: body.productId,
      skuCode: body.skuCode,
    }),
  };
}

export async function switchMiniprogramProductAttributeForSellable(
  db: D1Database,
  fetcher: typeof fetch,
  input: ProductAttributeSwitchInput,
) {
  const body = productAttributeSwitchBodySchema.parse(input);
  const context = await getSellableContextOrThrow(db, body.id, body.sign);
  const orderUser = await getMiniprogramOrderUserOrThrow(
    db,
    context.orderUserId,
  );
  const auth = authFromMiniprogramOrderUser(orderUser);
  const response = await postLuckinJson(
    fetcher,
    productPriceCalcPath,
    auth,
    buildProductPriceCalcPayload(body, context.coffeeCard),
    { sid: String(body.deptId) },
  );
  const content = extractLuckinContent(response, "product price calc");

  return {
    sellable: context,
    product: normalizeLuckinProductWithFallback(content, {
      productId: body.productId,
      skuCode: body.skuCode,
    }),
  };
}

export async function queryMiniprogramShopsForSellable(
  db: D1Database,
  fetcher: typeof fetch,
  input: ShopQueryInput,
) {
  const body = shopQueryBodySchema.parse(input);
  const context = await getSellableContextOrThrow(db, body.id, body.sign);
  const orderUser = await getMiniprogramOrderUserOrThrow(
    db,
    context.orderUserId,
  );
  const auth = authFromMiniprogramOrderUser(orderUser);
  const searchValue = body.deptName?.trim() ?? "";
  const response = await postLuckinJson(
    fetcher,
    searchValue ? shopSearchPath : shopListPath,
    auth,
    {
      longitude: body.longitude,
      latitude: body.latitude,
      userLongitude: body.longitude,
      userLatitude: body.latitude,
      channel: "GCJ-02",
      cityId: body.cityId,
      offSet: body.offSet,
      pageSize: body.pageSize,
      searchValue,
    },
  );
  const content = extractLuckinContent(response, "shop list");

  return {
    sellable: context,
    shops: extractShopList(content),
  };
}

export async function fetchMiniprogramCitiesForSellable(
  db: D1Database,
  fetcher: typeof fetch,
  input: CitiesInput,
) {
  const body = miniprogramSellableIdBodySchema.parse(input);
  const context = await getSellableContextOrThrow(db, body.id, body.sign);
  const orderUser = await getMiniprogramOrderUserOrThrow(
    db,
    context.orderUserId,
  );
  const auth = authFromMiniprogramOrderUser(orderUser);
  const response = await getLuckinJson(fetcher, openingCitysPath, auth, {});
  const content = extractLuckinContent(response, "opening cities");

  return {
    sellable: context,
    cities: extractCityList(content),
  };
}

export async function createMiniprogramOrderForSellable(
  db: D1Database,
  fetcher: typeof fetch,
  input: CreateOrderInput,
) {
  const body = createOrderBodySchema.parse(input);
  const context = await getSellableContextOrThrow(db, body.id, body.sign);

  if (context.status === "done") {
    throw new MiniprogramOrderError("Sellable product is already done", 409);
  }

  await db
    .prepare(
      `UPDATE miniprogram_sellable_products
			 SET status = 'pending'
			 WHERE id = ? AND is_delete = 0 AND status = 'waiting'`,
    )
    .bind(body.id)
    .run();

  const orderUser = await getMiniprogramOrderUserOrThrow(
    db,
    context.orderUserId,
  );
  const auth = authFromMiniprogramOrderUser(orderUser);
  assertPayAuth(auth);

  const previewPayload = buildPreviewPayload(body, auth);
  const previewResponse = await postLuckinJson(
    fetcher,
    previewPath,
    auth,
    previewPayload,
  );
  const preview = extractLuckinContent(previewResponse, "preview");
  assertZeroPayPreview(preview);

  const coffeeStoreMatchResponse = await postLuckinJson(
    fetcher,
    coffeeStoreMatchPath,
    auth,
    buildCoffeeStoreMatchPayload(previewPayload),
  );
  const coffeeStoreMatch = extractLuckinContent(
    coffeeStoreMatchResponse,
    "coffee store match",
  );

  const createPayload = buildCreatePayload(
    body,
    preview,
    coffeeStoreMatch,
    context.coffeeCard,
    auth,
  );
  const preCreatePayload = buildPreCreatePayload(createPayload);
  const preCreateResponse = await postLuckinJson(
    fetcher,
    preCreatePath,
    auth,
    preCreatePayload,
  );
  assertPreCreate(preCreateResponse);

  const createResponse = await postLuckinJson(
    fetcher,
    createPath,
    auth,
    createPayload,
  );
  const order = extractLuckinContent(createResponse, "create");
  const pay = await completePayIfNeeded(fetcher, body, auth, order);
  const actualCafeKuId = getActualCafeKuId(createPayload);
  const actualCoffeeCard = actualCafeKuId
    ? await getMiniprogramCoffeeCardByCafeKuId(
        db,
        context.orderUserId,
        actualCafeKuId,
      )
    : null;

  await markMiniprogramSellableDone(db, {
    id: body.id,
    orderId: getOrderId(order),
    productId: body.product.productId,
    skuCode: body.product.skuCode,
    productName: body.product.productName ?? null,
    actualCafeKuId,
    actualCoffeeCardId: actualCoffeeCard?.id ?? null,
  });

  return pay
    ? { preview, coffeeStoreMatch, order, pay }
    : { preview, coffeeStoreMatch, order };
}

export async function fetchMiniprogramOrderDetailForSellable(
  db: D1Database,
  fetcher: typeof fetch,
  input: OrderDetailInput,
) {
  const body = orderDetailBodySchema.parse(input);
  const context = await getSellableContextOrThrow(db, body.id, body.sign);
  const orderId = body.orderId ?? context.luckinOrderId;

  if (!orderId) {
    throw new MiniprogramOrderError("Luckin order id is required", 409);
  }

  const orderUser = await getMiniprogramOrderUserOrThrow(
    db,
    context.orderUserId,
  );
  const auth = authFromMiniprogramOrderUser(orderUser);
  const detailResponse = await postLuckinJson(fetcher, orderDetailPath, auth, {
    orderId,
  });
  const detail = extractLuckinContent(detailResponse, "order detail");

  if (detail.takeMealCodeInfo) {
    return { detail };
  }

  const takeCodeResponse = await postLuckinJson(fetcher, takeCodePath, auth, {
    orderId,
  });

  return {
    detail,
    takeCode: extractLuckinContent(takeCodeResponse, "take code"),
  };
}

async function getMiniprogramOrderUserOrThrow(db: D1Database, id: string) {
  const orderUser = await findActiveMiniprogramOrderUser(db, id);
  if (!orderUser) {
    throw new MiniprogramOrderError("Miniprogram order user not found", 404);
  }

  return orderUser;
}

async function getSellableContextOrThrow(
  db: D1Database,
  id: string,
  sign: string,
) {
  const sellable = await findActiveMiniprogramSellableWithCard(db, id, sign);
  if (!sellable) {
    throw new MiniprogramOrderError("Not Found", 404);
  }

  return sellable;
}

async function getMiniprogramCoffeeCardById(db: D1Database, id: number) {
  const row = await db
    .prepare(
      `SELECT *
			 FROM miniprogram_coffee_cards
			 WHERE id = ? AND is_delete = 0`,
    )
    .bind(id)
    .first<Parameters<typeof deserializeMiniprogramCoffeeCard>[0]>();

  return row ? deserializeMiniprogramCoffeeCard(row) : null;
}

async function getMiniprogramCoffeeCardByCafeKuId(
  db: D1Database,
  orderUserId: string,
  cafeKuId: string,
) {
  const row = await db
    .prepare(
      `SELECT *
			 FROM miniprogram_coffee_cards
			 WHERE order_user_id = ? AND cafe_ku_id = ? AND is_delete = 0`,
    )
    .bind(orderUserId, cafeKuId)
    .first<Parameters<typeof deserializeMiniprogramCoffeeCard>[0]>();

  return row ? deserializeMiniprogramCoffeeCard(row) : null;
}

async function insertSellableForCard(
  db: D1Database,
  card: Pick<MiniprogramCoffeeCardRow, "id" | "orderUserId">,
) {
  await db
    .prepare(
      `INSERT INTO miniprogram_sellable_products (
				id,
				sign,
				coffee_card_id,
				sellable_quantity,
				status,
				order_user_id,
				third_party_remark_id,
				luckin_order_id,
				selected_product_id,
				selected_sku_code,
				selected_product_name,
				ordered_at,
				is_delete
			)
			VALUES (?, ?, ?, 1, 'waiting', ?, NULL, NULL, NULL, NULL, NULL, NULL, 0)`,
    )
    .bind(
      generateMiniprogramSellableId(),
      generateMiniprogramSellableSign(),
      card.id,
      card.orderUserId,
    )
    .run();
}

async function deleteWaitingSellablesForCard(
  db: D1Database,
  cardId: number,
  count: number,
) {
  if (count <= 0) {
    return 0;
  }

  const rows = await db
    .prepare(
      `SELECT id
			 FROM miniprogram_sellable_products
			 WHERE coffee_card_id = ?
			   AND is_delete = 0
			   AND status = 'waiting'
			 ORDER BY id DESC
			 LIMIT ?`,
    )
    .bind(cardId, count)
    .all<{ id: string }>();

  for (const row of rows.results) {
    await db
      .prepare(
        `UPDATE miniprogram_sellable_products
				 SET is_delete = 1
				 WHERE id = ? AND is_delete = 0 AND status = 'waiting'`,
      )
      .bind(row.id)
      .run();
  }

  return rows.results.length;
}

async function listActiveSellablesForCard(db: D1Database, cardId: number) {
  const result = await db
    .prepare(
      `SELECT *
			 FROM miniprogram_sellable_products
			 WHERE coffee_card_id = ?
			   AND is_delete = 0
			   AND status IN ('waiting', 'pending')
			 ORDER BY id ASC`,
    )
    .bind(cardId)
    .all<Parameters<typeof deserializeMiniprogramSellable>[0]>();

  return result.results.map(deserializeMiniprogramSellable);
}

async function countActiveSellablesForCard(db: D1Database, cardId: number) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
			 FROM miniprogram_sellable_products
			 WHERE coffee_card_id = ?
			   AND is_delete = 0
			   AND status IN ('waiting', 'pending')`,
    )
    .bind(cardId)
    .first<{ count: number }>();

  return row?.count ?? 0;
}

async function updateCardGeneratedSellableCount(
  db: D1Database,
  cardId: number,
  count: number,
) {
  await db
    .prepare(
      `UPDATE miniprogram_coffee_cards
			 SET generated_sellable_count = ?
			 WHERE id = ? AND is_delete = 0`,
    )
    .bind(count, cardId)
    .run();

  return getMiniprogramCoffeeCardById(db, cardId);
}

function extractCoffeeCards(content: Record<string, unknown>) {
  if (Array.isArray(content.planList)) {
    return content.planList.filter(isRecord);
  }

  if (Array.isArray(content.usableList)) {
    return content.usableList.filter(isRecord);
  }

  if (Array.isArray(content.list)) {
    return content.list.filter(isRecord);
  }

  return [];
}

function normalizeCoffeeCard(
  orderUserId: string,
  raw: Record<string, unknown>,
) {
  const linkParams = parseLinkParams(stringValue(raw.link));
  const couponNo =
    stringValue(raw.couponNo) ??
    linkParams.get("couponNo") ??
    linkParams.get("cafeKuId");
  const cafeKuId =
    stringValue(raw.cafeKuId) ?? stringValue(raw.cardId) ?? couponNo;

  if (!cafeKuId) {
    return null;
  }

  return {
    orderUserId,
    cafeKuId,
    couponNo: couponNo ?? null,
    couponType: numberValue(linkParams.get("couponType")) ?? 0,
    coffeeVoucherType: numberValue(raw.coffeeVoucherType) ?? 0,
    cardName: extractCardName(raw),
    usableQuantity: extractUsableQuantity(raw) ?? 1,
    raw,
  };
}

function extractCardName(raw: Record<string, unknown>) {
  return (
    stringValue(raw.coffeeStockTitle) ??
    stringValue(raw.cafeKuName) ??
    stringValue(raw.couponName) ??
    stringValue(raw.cardName) ??
    stringValue(raw.name) ??
    stringValue(raw.title) ??
    null
  );
}

function extractUsableQuantity(raw: Record<string, unknown>) {
  const punchCardQuantity = extractQuantityFromText(
    stringValue(raw.punchCardDesc),
  );
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
    const valueNumber = numberValue(raw[key]);
    if (valueNumber !== null && valueNumber >= 0) {
      return Math.floor(valueNumber);
    }
  }

  for (const key of [
    "stockDesc",
    "coffeeStockTitle",
    "cafeKuName",
    "title",
    "desc",
  ]) {
    const textQuantity = extractQuantityFromText(stringValue(raw[key]));
    if (textQuantity !== null) {
      return textQuantity;
    }
  }

  return null;
}

function extractQuantityFromText(text?: string | null) {
  const matches = [
    ...(text?.matchAll(/(?:剩余|尚余|还剩)\s*\{?(\d+)\}?\s*(?:张|次|杯)?/g) ??
      []),
  ];
  const match = matches.at(-1);
  return match ? Number(match[1]) : null;
}

function parseLinkParams(link?: string | null) {
  const query = link?.split("?")[1] ?? "";
  return new URLSearchParams(query);
}

function couponNoForCard(
  card: Pick<MiniprogramCoffeeCardRow, "cafeKuId" | "couponNo">,
) {
  return card.couponNo || card.cafeKuId;
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
  };
}

function extractShopList(content: Record<string, unknown>) {
  if (Array.isArray(content.shopList)) {
    return content.shopList;
  }

  const common = Array.isArray(content.commonShopList)
    ? content.commonShopList
    : [];
  const other = Array.isArray(content.otherShopList)
    ? content.otherShopList
    : [];
  const nearShop = isRecord(content.nearShop) ? [content.nearShop] : [];

  return [...nearShop, ...common, ...other].filter(isRecord);
}

function extractCityList(content: Record<string, unknown>) {
  const source = Array.isArray(content)
    ? content
    : Array.isArray(content.cityList)
      ? content.cityList
      : Array.isArray(content.openingCityList)
        ? content.openingCityList
        : [];

  return source.filter(isRecord).map((city) => ({
    ...city,
    cityId: numberValue(city.cityId) ?? numberValue(city.id),
    cityName:
      stringValue(city.cityName) ??
      stringValue(city.name) ??
      stringValue(city.showName),
    showName:
      stringValue(city.showName) ??
      stringValue(city.cityName) ??
      stringValue(city.name),
    citySpell:
      stringValue(city.citySpell) ??
      stringValue(city.spell) ??
      stringValue(city.pinyin),
  }));
}

function buildProductDetailPayload(
  input: ProductDetailInput,
  card: MiniprogramCoffeeCardRow,
) {
  return {
    deptId: input.deptId,
    productId: input.productId,
    supportTakeout: input.supportTakeout,
    position: input.position,
    skuCode: input.skuCode,
    processTypeDetailList: input.processTypeDetailList,
    planNumber: input.planNumber,
    discountSchemeNo: input.discountSchemeNo,
    classifyIndex: input.classifyIndex,
    benefitNo: input.benefitNo,
    tipsCountAllow: 1,
    cardCouponParam: {
      couponNo: couponNoForCard(card),
      couponType: card.couponType || 2,
    },
  };
}

function buildProductPriceCalcPayload(
  input: ProductAttributeSwitchInput,
  card: MiniprogramCoffeeCardRow,
) {
  return {
    deptId: input.deptId,
    productId: input.productId,
    skuCode: input.skuCode,
    processTypeDetailList: input.processTypeDetailList,
    paymentAccountType: 1,
    supportTakeout: input.supportTakeout,
    group: input.group,
    position: input.position,
    recommendProductList: [],
    amount: input.amount,
    planNumber: input.planNumber,
    discountSchemeNo: input.discountSchemeNo,
    classifyIndex: input.classifyIndex,
    benefitNo: input.benefitNo,
    attrOperationParam: input.attrOperationParam,
    cardCouponParam: {
      couponNo: couponNoForCard(card),
      couponType: card.couponType || 2,
    },
  };
}

function normalizeLuckinProductWithFallback(
  product: Record<string, unknown>,
  fallback: { productId: number; skuCode?: string | null },
) {
  const normalized = normalizeLuckinProduct({
    ...product,
    productId: numberValue(product.productId) ?? fallback.productId,
    skuCode: stringValue(product.skuCode) ?? fallback.skuCode ?? "",
    productName:
      stringValue(product.productName) ??
      stringValue(product.name) ??
      stringValue(product.title) ??
      "商品",
  });

  if (!normalized) {
    throw new MiniprogramOrderError("Invalid Luckin product response", 502);
  }

  return normalized;
}

function buildPreviewPayload(input: CreateOrderInput, auth: MiniprogramAuth) {
  return {
    shopAbTest: true,
    cityId: input.cityId,
    scene: 0,
    longitude: input.longitude,
    latitude: input.latitude,
    deptId: input.deptId,
    addressId: "",
    comboList: [],
    productList: [toPreviewProduct(input)],
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
    miniversion: auth.version,
  };
}

function toPreviewProduct(input: CreateOrderInput) {
  return {
    indexId: 1,
    amount: input.product.amount,
    checked: 1,
    eatway: "both",
    productId: input.product.productId,
    skuCode: input.product.skuCode,
    processTypeDetailList: input.product.processTypeDetailList,
    cafeKuId: "",
    couponNo: "",
    coffeeVoucherType: 0,
  };
}

function buildCreatePayload(
  input: CreateOrderInput,
  preview: Record<string, unknown>,
  coffeeStoreMatch: Record<string, unknown>,
  card: MiniprogramCoffeeCardRow,
  auth: MiniprogramAuth,
) {
  const cardDiscount = numberValue(preview.cardDiscount) ?? 0;
  const previewCardCodeList = cardDiscount > 0 ? getArray(preview.cardCodeList) : [];

  const payload: Record<string, unknown> = {
    scene: 0,
    deptId: String(input.deptId),
    comboList: [],
    productList: mapCreateProductList(input, preview, coffeeStoreMatch, card),
    delivery: "pick",
    addressId: "",
    eatway: stringValue(preview.eatway) ?? "package",
    couponCodeList: getArray(preview.couponCodeList),
    limitCouponCodeList: getArray(preview.limitCouponCodeList),
    remark: input.remark,
    longitude: input.longitude,
    latitude: input.latitude,
    channel: "GCJ-02",
    submit: 0,
    submitOf600: 0,
    joinPlan: getArray(preview.joinPlan),
    appVersion: auth.version,
    needs: null,
    showAgain: 0,
    useCoffeeStore: numberValue(preview.useCoffeeStore) ?? 1,
    dispatchDistance: "",
    paymentAccountType: 1,
    showMsg: true,
    dispatchCouponList: getArray(preview.dispatchCouponCodeList),
    demotionType: numberValue(preview.demotionType) ?? 0,
    giftProductList: [],
    marketingChecked: numberValue(preview.marketingChecked) ?? 0,
    marketingNo: stringValue(preview.marketingNo) ?? "",
    payCardSceneType: numberValue(preview.payCardSceneType) ?? 1,
    cardCodeList: previewCardCodeList,
    payCardChecked: numberValue(preview.payCardChecked) ?? 0,
    payCardNo: stringValue(preview.payCardNo) ?? "",
    priority: numberValue(preview.priority) ?? 2,
    cashCardList: getArray(preview.cashCardList),
    blackBox: auth.blackBox ?? "",
    miniversion: auth.version,
    wxScene: input.wxScene,
  };

  if (auth.deviceId) {
    payload.did = auth.deviceId;
  }

  return payload;
}

function buildPreCreatePayload(createPayload: Record<string, unknown>) {
  const { wxScene: _wxScene, ...payload } = createPayload;
  return payload;
}

function buildCoffeeStoreMatchPayload(
  previewPayload: ReturnType<typeof buildPreviewPayload>,
) {
  return {
    ...previewPayload,
    productList: previewPayload.productList.map((product, index) => ({
      ...product,
      productIndex: index,
    })),
  };
}

function mapCreateProductList(
  input: CreateOrderInput,
  preview: Record<string, unknown>,
  coffeeStoreMatch: Record<string, unknown>,
  card: MiniprogramCoffeeCardRow,
) {
  const cardProduct =
    findMatchingProduct(getProductDetailList(preview), input) ??
    findMatchingProduct(getMatchedProductList(coffeeStoreMatch), input);

  return [mapCreateProduct(input, cardProduct, card)];
}

function mapCreateProduct(
  input: CreateOrderInput,
  cardProduct: Record<string, unknown> | null,
  card: MiniprogramCoffeeCardRow,
) {
  const selectedProduct = input.product as Record<string, unknown>;
  const selectedProcessTypeDetailList = Array.isArray(
    selectedProduct.processTypeDetailList,
  )
    ? selectedProduct.processTypeDetailList
    : [];
  const cardProcessTypeDetailList =
    cardProduct && Array.isArray(cardProduct.processTypeDetailList)
      ? cardProduct.processTypeDetailList
      : [];
  const supportChangeProcessType =
    numberValue(selectedProduct.supportChangeProcessType) ??
    numberValue(cardProduct?.supportChangeProcessType) ??
    0;

  const base = withOptionalProductFields(
    withOptionalProductFields(
      {
        indexId:
          numberValue(selectedProduct.indexId) ??
          numberValue(cardProduct?.indexId) ??
          1,
        productId: input.product.productId,
        skuCode: input.product.skuCode,
        amount: input.product.amount,
        cafeKuId: stringValue(cardProduct?.cafeKuId) ?? card.cafeKuId,
        couponNo: stringValue(cardProduct?.couponNo) ?? "",
        coffeeVoucherType:
          numberValue(cardProduct?.coffeeVoucherType) ?? card.coffeeVoucherType,
        processTypeDetailList: selectedProcessTypeDetailList.length
          ? selectedProcessTypeDetailList
          : cardProcessTypeDetailList,
        supportChangeProcessType,
      },
      cardProduct ?? {},
    ),
    selectedProduct,
  );

  return base;
}

function withOptionalProductFields(
  base: Record<string, unknown>,
  source: Record<string, unknown>,
) {
  const passthroughKeys = [
    "abName",
    "activityFlag",
    "group",
    "groupType",
    "itemFromLocation",
    "matchedSaleAttributeId",
    "storeyType",
    "transmission",
  ];

  for (const key of passthroughKeys) {
    if (source[key] !== undefined && source[key] !== null) {
      base[key] = source[key];
    }
  }

  return base;
}

function findMatchingProduct(
  products: Record<string, unknown>[],
  input: CreateOrderInput,
) {
  const productId = String(input.product.productId);
  const indexId = String(numberValue(input.product.indexId) ?? 1);
  const exact = products.find(
    (product) =>
      String(numberValue(product.indexId) ?? "") === indexId &&
      String(numberValue(product.productId) ?? "") === productId,
  );

  if (exact) {
    return exact;
  }

  return (
    products.find(
      (product) => String(numberValue(product.productId) ?? "") === productId,
    ) ??
    products[0] ??
    null
  );
}

function getActualCafeKuId(createPayload: Record<string, unknown>) {
  const productList = Array.isArray(createPayload.productList)
    ? createPayload.productList
    : [];
  const product = productList.find(isRecord);

  return product ? stringValue(product.cafeKuId) : null;
}

async function completePayIfNeeded(
  fetcher: typeof fetch,
  input: CreateOrderInput,
  auth: MiniprogramAuth,
  order: Record<string, unknown>,
) {
  if (order.forwardPage !== "pay") {
    return null;
  }

  const orderId = getOrderId(order);
  if (!orderId) {
    throw new MiniprogramOrderError("Invalid Luckin create response", 502);
  }

  const payResponse = await postLuckinJson(
    fetcher,
    payPath,
    auth,
    {
      blackBox: auth.blackBox ?? "",
      longitude: input.longitude,
      latitude: input.latitude,
      payType: auth.payType ?? "7",
      busType: 0,
      orderRedeem: order.orderRedeem,
      openid: auth.openid ?? "",
      videoPayment: order.videoPayment,
      notifyCode: auth.notifyCode ?? "",
      orderId,
      miniversion: auth.version,
    },
    { sid: String(input.deptId) },
  );
  const pay = extractLuckinContent(payResponse, "pay");
  assertZeroPayCompletion(pay);

  return pay;
}

function assertPayAuth(auth: MiniprogramAuth) {
  if (!auth.openid) {
    throw new MiniprogramOrderError(
      "Luckin miniprogram openid is required",
      409,
    );
  }
}

function assertPreCreate(response: {
  code?: number;
  busiCode?: string;
  msg?: string;
}) {
  if (response.code === 1) {
    return;
  }

  if (response.code === 7 && response.busiCode === "BASE900") {
    return;
  }

  throw new MiniprogramClientError(
    response.msg || "Luckin preCreate request failed",
    502,
  );
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

  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function getMatchedProductList(coffeeStoreMatch: Record<string, unknown>) {
  return Array.isArray(coffeeStoreMatch.productList)
    ? coffeeStoreMatch.productList.filter(isRecord)
    : [];
}

function getOrderId(order: Record<string, unknown>) {
  const orderId = order.orderId ?? order.orderIdStr;
  return typeof orderId === "string" || typeof orderId === "number"
    ? String(orderId)
    : null;
}

function getArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNullable<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

async function readJson(c: AppContext) {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

async function parseBody<T extends z.ZodTypeAny>(
  c: AppContext,
  schema: T,
): Promise<z.infer<T> | Response> {
  const parsed = schema.safeParse(await readJson(c));
  if (!parsed.success) {
    return c.json(
      {
        code: 400,
        errors: parsed.error.issues.map((issue) => ({
          code: 400,
          message: issue.path.length
            ? `${issue.path.join(".")}: ${issue.message}`
            : issue.message,
        })),
      },
      400,
    );
  }

  return parsed.data;
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

async function handleMiniprogramError(c: AppContext, error: unknown) {
  if (
    error instanceof MiniprogramOrderError ||
    error instanceof MiniprogramClientError
  ) {
    return fail(c, error.message, error.status);
  }

  throw error;
}

const hono = new Hono<{ Bindings: Env }>();

hono.post("/detail", async (c: AppContext) => {
  const body = await parseBody(c, miniprogramSellableIdBodySchema);
  if (isResponse(body)) {
    return body;
  }

  const row = await findActiveMiniprogramSellableWithCard(
    c.env.DB,
    body.id,
    body.sign,
  );
  return row ? ok(c, row) : fail(c, "Not Found", 404);
});

hono.post("/shops/query", async (c: AppContext) => {
  const body = await parseBody(c, shopQueryBodySchema);
  if (isResponse(body)) {
    return body;
  }

  try {
    return ok(c, await queryMiniprogramShopsForSellable(c.env.DB, fetch, body));
  } catch (error) {
    return handleMiniprogramError(c, error);
  }
});

hono.post("/cities", async (c: AppContext) => {
  const body = await parseBody(c, miniprogramSellableIdBodySchema);
  if (isResponse(body)) {
    return body;
  }

  try {
    return ok(c, await fetchMiniprogramCitiesForSellable(c.env.DB, fetch, body));
  } catch (error) {
    return handleMiniprogramError(c, error);
  }
});

hono.post("/card-products", async (c: AppContext) => {
  const body = await parseBody(c, cardProductsBodySchema);
  if (isResponse(body)) {
    return body;
  }

  try {
    return ok(
      c,
      await fetchMiniprogramCardProductsForSellable(c.env.DB, fetch, body),
    );
  } catch (error) {
    return handleMiniprogramError(c, error);
  }
});

hono.post("/product-detail", async (c: AppContext) => {
  const body = await parseBody(c, productDetailBodySchema);
  if (isResponse(body)) {
    return body;
  }

  try {
    return ok(
      c,
      await fetchMiniprogramProductDetailForSellable(c.env.DB, fetch, body),
    );
  } catch (error) {
    return handleMiniprogramError(c, error);
  }
});

hono.post("/product-price-calc", async (c: AppContext) => {
  const body = await parseBody(c, productAttributeSwitchBodySchema);
  if (isResponse(body)) {
    return body;
  }

  try {
    return ok(
      c,
      await switchMiniprogramProductAttributeForSellable(c.env.DB, fetch, body),
    );
  } catch (error) {
    return handleMiniprogramError(c, error);
  }
});

hono.post("/create", async (c: AppContext) => {
  const body = await parseBody(c, createOrderBodySchema);
  if (isResponse(body)) {
    return body;
  }

  try {
    return ok(
      c,
      await createMiniprogramOrderForSellable(c.env.DB, fetch, body),
    );
  } catch (error) {
    return handleMiniprogramError(c, error);
  }
});

hono.post("/order-detail", async (c: AppContext) => {
  const body = await parseBody(c, orderDetailBodySchema);
  if (isResponse(body)) {
    return body;
  }

  try {
    return ok(
      c,
      await fetchMiniprogramOrderDetailForSellable(c.env.DB, fetch, body),
    );
  } catch (error) {
    return handleMiniprogramError(c, error);
  }
});

hono.post("/sync-coffee-cards", async (c: AppContext) => {
  const body = await parseBody(c, syncCoffeeCardsBodySchema);
  if (isResponse(body)) {
    return body;
  }

  try {
    return ok(c, await syncMiniprogramCoffeeCards(c.env.DB, fetch, body));
  } catch (error) {
    return handleMiniprogramError(c, error);
  }
});

export const miniprogramOrderRouter = fromHono(hono);

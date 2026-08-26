import { env } from "cloudflare:test";
import CryptoJS from "crypto-js";
import { describe, expect, it } from "vitest";
import {
  createMiniprogramOrderForSellable,
  fetchMiniprogramCardProductsForSellable,
  fetchMiniprogramProductDetailForSellable,
  switchMiniprogramProductAttributeForSellable,
  syncMiniprogramCoffeeCards,
} from "../../src/controller/miniprogramorder/miniprogramorder";

const miniprogramAesKey = "CJQjAc1hYieC4QYb";
const miniprogramUid =
  "f931e729-4279-4d30-bdc5-0254af362e551787569733931-2926637-efAmj7k25Su8lEAGHeSrLLDaF7WCSl67RQEGsHnOQYYh3CdepZU4TszMDkSxpjkO";
const miniprogramSellableIdPattern = /^[0-9A-Z_a-z-]{31}$/;
const wrongMiniprogramSellableSign = "WRONG0123456789ABCDEFGHIJKLMNOP";

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

  return CryptoJS.MD5(`${plain}${miniprogramAesKey}`)
    .words.map((word) => Math.abs(word).toString())
    .join("");
}

function encryptedMiniprogramResponse(payload: Record<string, unknown>) {
  return new Response(encryptMiniprogramPayload(payload), {
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
  });
}

async function createMiniprogramOrderUser() {
  const id = `mp${Math.random().toString(36).slice(2, 10)}`.slice(0, 10);

  await env.DB.prepare(
    `INSERT INTO miniprogram_order_users (
			id,
			nickname,
			status,
			uid,
			openid,
			black_box,
			notify_code,
			csid,
			pay_type,
			miniprogram_version,
			aes_key,
			base_url,
			cookie,
			is_delete
		)
		VALUES (?, ?, 'enabled', ?, ?, ?, ?, ?, '7', '5587', ?, 'https://capi.lkcoffee.com', ?, 0)`,
  )
    .bind(
      id,
      `mini account ${id}`,
      miniprogramUid,
      "openid-test",
      "blackbox-test",
      "notify-test",
      "csid-test",
      miniprogramAesKey,
      `uid=${miniprogramUid}`,
    )
    .run();

  return id;
}

async function firstSellableForCard(coffeeCardId: number) {
  return env.DB.prepare(
    `SELECT id, sign FROM miniprogram_sellable_products
     WHERE coffee_card_id = ? AND is_delete = 0
     LIMIT 1`,
  )
    .bind(coffeeCardId)
    .first<{ id: string; sign: string }>();
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

describe("miniprogram coffee-card ordering", () => {
  it("syncs coffee cards into new miniprogram tables and creates one sellable row per remaining use", async () => {
    const orderUserId = await createMiniprogramOrderUser();
    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      expect(request.method).toBe("POST");
      expect(request.url).toBe(
        "https://capi.lkcoffee.com/resource/m/promotion/v2/myself/list",
      );
      expect(request.headers.get("cookie")).toBe(`uid=${miniprogramUid}`);
      expect(await requestPayload(request)).toEqual({ miniversion: "5587" });

      return encryptedMiniprogramResponse({
        code: 1,
        msg: "success",
        content: {
          planList: [
            {
              link: "/pages/index/menu?isCouponUse=true&couponNo=CK001&couponType=2",
              coffeeStockTitle: "全品类20选1",
              stockDesc: "尚余3张",
              stockNum: 3,
            },
          ],
        },
      });
    };

    const result = await syncMiniprogramCoffeeCards(env.DB, fetcher, {
      orderUserId,
    });

    expect(result).toEqual(
      expect.objectContaining({
        syncedCount: 1,
        generatedSellableCount: 3,
      }),
    );
    expect(result.cards[0]).toEqual(
      expect.objectContaining({
        orderUserId,
        cafeKuId: "CK001",
        couponNo: "CK001",
        couponType: 2,
        coffeeVoucherType: 0,
        cardName: "全品类20选1",
        usableQuantity: 3,
        generatedSellableCount: 3,
      }),
    );

    const sellables = await env.DB.prepare(
      `SELECT id, sign, coffee_card_id, sellable_quantity, status, order_user_id
			 FROM miniprogram_sellable_products
			 WHERE order_user_id = ? AND is_delete = 0`,
    )
      .bind(orderUserId)
      .all<{
        id: string;
        sign: string;
        coffee_card_id: number;
        sellable_quantity: number;
        status: string;
        order_user_id: string;
      }>();
    expect(sellables.results).toHaveLength(3);
    for (const sellable of sellables.results) {
      expect(sellable.id).toMatch(miniprogramSellableIdPattern);
      expect(sellable.sign).toMatch(miniprogramSellableIdPattern);
      expect(sellable.sign).not.toBe(sellable.id);
      expect(sellable.coffee_card_id).toBe(result.cards[0].id);
      expect(sellable.sellable_quantity).toBe(1);
      expect(sellable.status).toBe("waiting");
      expect(sellable.order_user_id).toBe(orderUserId);
    }

    const legacyProducts = await env.DB.prepare(
      "SELECT product_id FROM lucky_products WHERE source_query = 'coffee-card:CK001'",
    ).all();
    expect(legacyProducts.results).toEqual([]);
  });

  it("uses punch-card remaining text before zero stock number when syncing coffee cards", async () => {
    const orderUserId = await createMiniprogramOrderUser();

    const result = await syncMiniprogramCoffeeCards(
      env.DB,
      async () =>
        encryptedMiniprogramResponse({
          code: 1,
          content: {
            planList: [
              {
                link: "/pages/index/menu?isCouponUse=true&couponNo=CK010&couponType=3",
                coffeeVoucherType: 1,
                coffeeStockTitle: "超值十次卡",
                punchCardDesc: "已使用{0}次，还剩{10}次",
                stockDesc: "",
                stockNum: 0,
              },
            ],
          },
        }),
      { orderUserId },
    );

    expect(result).toEqual(
      expect.objectContaining({
        syncedCount: 1,
        generatedSellableCount: 10,
      }),
    );
    expect(result.cards[0]).toEqual(
      expect.objectContaining({
        orderUserId,
        cafeKuId: "CK010",
        couponNo: "CK010",
        couponType: 3,
        coffeeVoucherType: 1,
        cardName: "超值十次卡",
        usableQuantity: 10,
        generatedSellableCount: 10,
      }),
    );

    const sellables = await env.DB.prepare(
      `SELECT id
			 FROM miniprogram_sellable_products
			 WHERE coffee_card_id = ? AND is_delete = 0`,
    )
      .bind(result.cards[0].id)
      .all();
    expect(sellables.results).toHaveLength(10);
  });

  it("fetches card usable products only after a sellable row and shop are selected", async () => {
    const orderUserId = await createMiniprogramOrderUser();
    const syncResult = await syncMiniprogramCoffeeCards(
      env.DB,
      async () =>
        encryptedMiniprogramResponse({
          code: 1,
          content: {
            planList: [
              {
                link: "/pages/index/menu?isCouponUse=true&couponNo=CK002&couponType=2",
                coffeeVoucherType: 0,
                coffeeStockTitle: "门店可用卡",
                stockNum: 1,
              },
            ],
          },
        }),
      { orderUserId },
    );
    const sellable = await firstSellableForCard(syncResult.cards[0].id);

    const result = await fetchMiniprogramCardProductsForSellable(
      env.DB,
      async (input, init) => {
        const request = new Request(input, init);
        expect(request.method).toBe("POST");
        expect(request.url).toBe(
          "https://capi.lkcoffee.com/resource/core/v3/product/cardCouponZone",
        );
        expect(await requestPayload(request)).toEqual({
          deptId: 613299,
          supportTakeout: 0,
          couponType: 2,
          couponNo: "CK002",
        });

        return encryptedMiniprogramResponse({
          code: 1,
          content: {
            productList: [
              {
                productId: 5151,
                skuCode: "SP3571-00244",
                name: "标准美式",
                defaultPicUrl: "https://img.example.test/americano.png",
                estimatePrice: 0,
              },
            ],
          },
        });
      },
      {
        id: sellable?.id ?? "",
        sign: sellable?.sign ?? "",
        deptId: 613299,
        supportTakeout: 0,
      },
    );

    expect(result.products).toEqual([
      expect.objectContaining({
        productId: 5151,
        skuCode: "SP3571-00244",
        productName: "标准美式",
        pictureUrl: "https://img.example.test/americano.png",
      }),
    ]);
  });

  it("rejects a correct sellable id with the wrong sign before calling Luckin", async () => {
    const orderUserId = await createMiniprogramOrderUser();
    const syncResult = await syncMiniprogramCoffeeCards(
      env.DB,
      async () =>
        encryptedMiniprogramResponse({
          code: 1,
          content: {
            planList: [
              {
                link: "/pages/index/menu?isCouponUse=true&couponNo=CKSIGN&couponType=2",
                coffeeStockTitle: "验签卡",
                stockNum: 1,
              },
            ],
          },
        }),
      { orderUserId },
    );
    const sellable = await firstSellableForCard(syncResult.cards[0].id);
    let luckinCalled = false;

    await expect(
      fetchMiniprogramCardProductsForSellable(
        env.DB,
        async () => {
          luckinCalled = true;
          return encryptedMiniprogramResponse({ code: 1, content: {} });
        },
        {
          id: sellable?.id ?? "",
          sign: wrongMiniprogramSellableSign,
          deptId: 613299,
          supportTakeout: 0,
        },
      ),
    ).rejects.toMatchObject({ message: "Not Found", status: 404 });
    expect(luckinCalled).toBe(false);
  });

  it("fetches mini-program product detail with coffee card context after a product is selected", async () => {
    const orderUserId = await createMiniprogramOrderUser();
    const syncResult = await syncMiniprogramCoffeeCards(
      env.DB,
      async () =>
        encryptedMiniprogramResponse({
          code: 1,
          content: {
            planList: [
              {
                link: "/pages/index/menu?isCouponUse=true&couponNo=CKDETAIL&couponType=2",
                coffeeStockTitle: "详情卡",
                stockNum: 1,
              },
            ],
          },
        }),
      { orderUserId },
    );
    const sellable = await firstSellableForCard(syncResult.cards[0].id);

    const result = await fetchMiniprogramProductDetailForSellable(
      env.DB,
      async (input, init) => {
        const request = new Request(input, init);
        expect(request.method).toBe("POST");
        expect(request.url).toBe(
          "https://capi.lkcoffee.com/resource/core/v2/product/detail",
        );
        expect(await requestPayload(request)).toEqual({
          deptId: 613299,
          productId: 5151,
          supportTakeout: 0,
          position: 0,
          skuCode: "SP3571-00244",
          processTypeDetailList: [],
          planNumber: "",
          discountSchemeNo: "",
          classifyIndex: "",
          benefitNo: "",
          tipsCountAllow: 1,
          cardCouponParam: {
            couponNo: "CKDETAIL",
            couponType: 2,
          },
        });

        return encryptedMiniprogramResponse({
          code: 1,
          content: {
            productId: 5151,
            skuCode: "SP3571-00244",
            name: "标准美式",
            productAttrs: [
              {
                attributeId: 101,
                attributeName: "温度",
                productSubAttrs: [{ attributeId: 201, attributeName: "冰", selected: 1 }],
              },
            ],
          },
        });
      },
      {
        id: sellable?.id ?? "",
        sign: sellable?.sign ?? "",
        deptId: 613299,
        productId: 5151,
        skuCode: "SP3571-00244",
      },
    );

    expect(result.product).toEqual(
      expect.objectContaining({
        productId: 5151,
        skuCode: "SP3571-00244",
        productName: "标准美式",
        productAttrs: [
          {
            attributeId: 101,
            attributeName: "温度",
            productSubAttrs: [{ attributeId: 201, attributeName: "冰", selected: 1 }],
          },
        ],
      }),
    );
  });

  it("switches mini-program product attributes through priceCalc", async () => {
    const orderUserId = await createMiniprogramOrderUser();
    const syncResult = await syncMiniprogramCoffeeCards(
      env.DB,
      async () =>
        encryptedMiniprogramResponse({
          code: 1,
          content: {
            planList: [
              {
                link: "/pages/index/menu?isCouponUse=true&couponNo=CKPRICE&couponType=2",
                coffeeStockTitle: "属性卡",
                stockNum: 1,
              },
            ],
          },
        }),
      { orderUserId },
    );
    const sellable = await firstSellableForCard(syncResult.cards[0].id);

    const result = await switchMiniprogramProductAttributeForSellable(
      env.DB,
      async (input, init) => {
        const request = new Request(input, init);
        expect(request.method).toBe("POST");
        expect(request.url).toBe(
          "https://capi.lkcoffee.com/resource/core/v2/product/priceCalc",
        );
        expect(await requestPayload(request)).toEqual({
          deptId: 613299,
          productId: 5151,
          skuCode: "SP3571-HOT",
          processTypeDetailList: [],
          paymentAccountType: 1,
          supportTakeout: 0,
          group: "",
          position: 0,
          recommendProductList: [],
          amount: 1,
          planNumber: "",
          discountSchemeNo: "",
          classifyIndex: "",
          benefitNo: "",
          attrOperationParam: {
            attributeId: 101,
            subAttr: {
              attributeId: 202,
              attributeName: "热",
              step: 1,
              name: "热",
            },
          },
        });

        return encryptedMiniprogramResponse({
          code: 1,
          content: {
            productId: 5151,
            skuCode: "SP3571-HOT",
            name: "标准美式",
            processTypeDetailList: [{ type: "temperature", value: "hot" }],
          },
        });
      },
      {
        id: sellable?.id ?? "",
        sign: sellable?.sign ?? "",
        deptId: 613299,
        productId: 5151,
        skuCode: "SP3571-HOT",
        processTypeDetailList: [],
        attrOperationParam: {
          attributeId: 101,
          subAttr: {
            attributeId: 202,
            attributeName: "热",
            step: 1,
            name: "热",
          },
        },
      },
    );

    expect(result.product).toEqual(
      expect.objectContaining({
        productId: 5151,
        skuCode: "SP3571-HOT",
        productName: "标准美式",
        processTypeDetailList: [{ type: "temperature", value: "hot" }],
      }),
    );
  });

  it("previews, creates, completes zero-pay, and marks the miniprogram sellable row done", async () => {
    const orderUserId = await createMiniprogramOrderUser();
    const syncResult = await syncMiniprogramCoffeeCards(
      env.DB,
      async () =>
        encryptedMiniprogramResponse({
          code: 1,
          content: {
            planList: [
              {
                link: "/pages/index/menu?isCouponUse=true&couponNo=CK003&couponType=2",
                coffeeVoucherType: 1,
                coffeeStockTitle: "零元下单卡",
                stockNum: 1,
              },
            ],
          },
        }),
      { orderUserId },
    );
    const sellable = await firstSellableForCard(syncResult.cards[0].id);
    const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];

    const result = await createMiniprogramOrderForSellable(
      env.DB,
      async (input, init) => {
        const request = new Request(input, init);
        const payload = await requestPayload(request);
        calls.push({ url: request.url, payload });

        if (request.url.endsWith("/resource/core/v2/order/preview")) {
          return encryptedMiniprogramResponse({
            code: 1,
            content: {
              discountPrice: 0,
              productDetailList: [
                {
                  indexId: 1,
                  productId: 5151,
                  skuCode: "SP3571-00244",
                  amount: 1,
                  cafeKuId: "CK003",
                  couponNo: "",
                  coffeeVoucherType: 1,
                  processTypeDetailList: [],
                  supportChangeProcessType: 0,
                },
              ],
            },
          });
        }

        if (request.url.endsWith("/resource/core/v1/order/create")) {
          return encryptedMiniprogramResponse({
            code: 1,
            content: {
              orderId: "ORDER001",
              forwardPage: "pay",
              orderRedeem: {},
              videoPayment: {},
            },
          });
        }

        return encryptedMiniprogramResponse({
          code: 1,
          content: {
            payStatus: 1,
            needPay: false,
            desc: "支付成功",
          },
        });
      },
      {
        id: sellable?.id ?? "",
        sign: sellable?.sign ?? "",
        deptId: 613299,
        longitude: 121.365,
        latitude: 31.171,
        product: {
          productId: 5151,
          skuCode: "SP3571-00244",
          productName: "标准美式",
          amount: 1,
        },
      },
    );

    expect(calls.map((call) => call.url)).toEqual([
      "https://capi.lkcoffee.com/resource/core/v2/order/preview",
      "https://capi.lkcoffee.com/resource/core/v1/order/create",
      "https://capi.lkcoffee.com/resource/core/v2/pay/topay",
    ]);
    expect(calls[0].payload.productList).toEqual([
      expect.objectContaining({
        productId: 5151,
        skuCode: "SP3571-00244",
        cafeKuId: "CK003",
        couponNo: "",
        coffeeVoucherType: 1,
      }),
    ]);
    expect(calls[1].payload.productList).toEqual([
      expect.objectContaining({
        productId: 5151,
        skuCode: "SP3571-00244",
        cafeKuId: "CK003",
        couponNo: "",
        coffeeVoucherType: 1,
      }),
    ]);
    expect(result.order).toEqual(
      expect.objectContaining({ orderId: "ORDER001" }),
    );

    const row = await env.DB.prepare(
      `SELECT status, luckin_order_id, selected_product_id, selected_sku_code
			 FROM miniprogram_sellable_products
			 WHERE id = ?`,
    )
      .bind(sellable?.id ?? "")
      .first<{
        status: string;
        luckin_order_id: string;
        selected_product_id: number;
        selected_sku_code: string;
      }>();
    expect(row).toEqual({
      status: "done",
      luckin_order_id: "ORDER001",
      selected_product_id: 5151,
      selected_sku_code: "SP3571-00244",
    });
  });
});

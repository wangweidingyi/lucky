import { env } from "cloudflare:test";
import CryptoJS from "crypto-js";
import { describe, expect, it } from "vitest";
import {
  createMiniprogramOrderForSellable,
  fetchMiniprogramCardProductsForSellable,
  fetchMiniprogramCitiesForSellable,
  fetchMiniprogramProductDetailForSellable,
  generateMiniprogramSellablesForCard,
  queryMiniprogramShopsForSellable,
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
			device_id,
			notify_code,
			csid,
			pay_type,
			miniprogram_version,
			aes_key,
			base_url,
			cookie,
			is_delete
		)
		VALUES (?, ?, 'enabled', ?, ?, ?, ?, ?, ?, '7', '5587', ?, 'https://capi.lkcoffee.com', ?, 0)`,
  )
    .bind(
      id,
      `mini account ${id}`,
      miniprogramUid,
      "openid-test",
      "blackbox-test",
      "DXHQIwTYZMEwGKGPEj3jLbuxZ5z5zde0M5ac",
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

async function firstGeneratedSellableForCard(coffeeCardId: number) {
  await generateMiniprogramSellablesForCard(env.DB, {
    id: coffeeCardId,
    force: true,
  });

  return firstSellableForCard(coffeeCardId);
}

async function requestPayload(request: Request) {
  const rawBody = new TextDecoder().decode(await request.arrayBuffer());
  const params = new URLSearchParams(rawBody);
  return requestPayloadFromParams(params);
}

function requestPayloadFromUrl(request: Request) {
  return requestPayloadFromParams(new URL(request.url).searchParams);
}

function requestPayloadFromParams(params: URLSearchParams) {
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
  it("syncs coffee cards into new miniprogram tables without creating sellable rows", async () => {
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
        generatedSellableCount: 0,
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
        generatedSellableCount: 0,
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
    expect(sellables.results).toEqual([]);

    const legacyProducts = await env.DB.prepare(
      "SELECT product_id FROM lucky_products WHERE source_query = 'coffee-card:CK001'",
    ).all();
    expect(legacyProducts.results).toEqual([]);
  });

  it("syncs coffee cards without replacing existing active sellable links", async () => {
    const orderUserId = await createMiniprogramOrderUser();

    const firstSync = await syncMiniprogramCoffeeCards(
      env.DB,
      async () =>
        encryptedMiniprogramResponse({
          code: 1,
          content: {
            planList: [
              {
                link: "/pages/index/menu?isCouponUse=true&couponNo=CK011&couponType=2",
                coffeeStockTitle: "已上架卡券",
                stockNum: 2,
              },
            ],
          },
        }),
      { orderUserId },
    );

    await env.DB.prepare(
      `INSERT INTO miniprogram_sellable_products (
        id,
        sign,
        coffee_card_id,
        sellable_quantity,
        status,
        order_user_id,
        is_delete
      )
      VALUES (?, ?, ?, 1, 'waiting', ?, 0)`,
    )
      .bind(
        "KEEP0123456789ABCDEFGHIJKLMNOPQ",
        "SIGNKEEP0123456789ABCDEFGHIJKLM",
        firstSync.cards[0].id,
        orderUserId,
      )
      .run();

    await syncMiniprogramCoffeeCards(
      env.DB,
      async () =>
        encryptedMiniprogramResponse({
          code: 1,
          content: {
            planList: [
              {
                link: "/pages/index/menu?isCouponUse=true&couponNo=CK011&couponType=2",
                coffeeStockTitle: "已上架卡券",
                stockNum: 2,
              },
            ],
          },
        }),
      { orderUserId },
    );

    const sellables = await env.DB.prepare(
      `SELECT id, sign, status, is_delete
       FROM miniprogram_sellable_products
       WHERE coffee_card_id = ?
       ORDER BY id ASC`,
    )
      .bind(firstSync.cards[0].id)
      .all<{
        id: string;
        sign: string;
        status: string;
        is_delete: number;
      }>();

    expect(sellables.results).toEqual([
      {
        id: "KEEP0123456789ABCDEFGHIJKLMNOPQ",
        sign: "SIGNKEEP0123456789ABCDEFGHIJKLM",
        status: "waiting",
        is_delete: 0,
      },
    ]);
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
        generatedSellableCount: 0,
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
        generatedSellableCount: 0,
      }),
    );

    const sellables = await env.DB.prepare(
      `SELECT id
			 FROM miniprogram_sellable_products
			 WHERE coffee_card_id = ? AND is_delete = 0`,
    )
      .bind(result.cards[0].id)
      .all();
    expect(sellables.results).toEqual([]);
  });

  it("fetches opening cities through the signed mini-program request", async () => {
    const orderUserId = await createMiniprogramOrderUser();
    const syncResult = await syncMiniprogramCoffeeCards(
      env.DB,
      async () =>
        encryptedMiniprogramResponse({
          code: 1,
          content: {
            planList: [
              {
                link: "/pages/index/menu?isCouponUse=true&couponNo=CK012&couponType=2",
                coffeeStockTitle: "城市门店卡",
                stockNum: 1,
              },
            ],
          },
        }),
      { orderUserId },
    );
    const sellable = await firstGeneratedSellableForCard(
      syncResult.cards[0].id,
    );

    const result = await fetchMiniprogramCitiesForSellable(
      env.DB,
      async (input, init) => {
        const request = new Request(input, init);
        expect(request.method).toBe("GET");
        expect(request.url).toContain(
          "https://capi.lkcoffee.com/resource/m/sys/app/openingcitys?",
        );
        expect(request.headers.get("cookie")).toBe(`uid=${miniprogramUid}`);
        expect(requestPayloadFromUrl(request)).toEqual({});

        return encryptedMiniprogramResponse({
          code: 1,
          status: "SUCCESS",
          content: [
            {
              cityId: 2,
              cityName: "上海市",
              showName: "上海",
              citySpell: "shanghai",
            },
            {
              cityId: 1,
              cityName: "北京市",
              showName: "北京",
              citySpell: "beijing",
            },
          ],
        });
      },
      {
        id: sellable?.id ?? "",
        sign: sellable?.sign ?? "",
      },
    );

    expect(result.cities).toEqual([
      expect.objectContaining({
        cityId: 2,
        cityName: "上海市",
        showName: "上海",
        citySpell: "shanghai",
      }),
      expect.objectContaining({
        cityId: 1,
        cityName: "北京市",
        showName: "北京",
        citySpell: "beijing",
      }),
    ]);
  });

  it("searches shops by name or address with the default pagination payload", async () => {
    const orderUserId = await createMiniprogramOrderUser();
    const syncResult = await syncMiniprogramCoffeeCards(
      env.DB,
      async () =>
        encryptedMiniprogramResponse({
          code: 1,
          content: {
            planList: [
              {
                link: "/pages/index/menu?isCouponUse=true&couponNo=CK090&couponType=2",
                coffeeStockTitle: "搜索门店卡",
                stockNum: 1,
              },
            ],
          },
        }),
      { orderUserId },
    );
    const sellable = await firstGeneratedSellableForCard(syncResult.cards[0].id);

    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      expect(request.method).toBe("POST");
      expect(request.url).toBe("https://capi.lkcoffee.com/resource/m/shop/list");
      expect(request.headers.get("cookie")).toBe(`uid=${miniprogramUid}`);
      expect(await requestPayload(request)).toEqual({
        longitude: 121.365,
        latitude: 31.171,
        userLongitude: 121.365,
        userLatitude: 31.171,
        channel: "GCJ-02",
        cityId: 2,
        searchValue: "虹桥",
        offSet: 0,
        pageSize: 10,
      });

      return encryptedMiniprogramResponse({
        code: 1,
        content: {
          shopList: [
            {
              deptId: 613299,
              deptName: "上海虹桥天地店",
              address: "申长路 688 号",
            },
          ],
        },
      });
    };

    const result = await queryMiniprogramShopsForSellable(
      env.DB,
      fetcher,
      {
        id: sellable?.id ?? "",
        sign: sellable?.sign ?? "",
        longitude: 121.365,
        latitude: 31.171,
        cityId: 2,
        searchValue: "虹桥",
      },
    );

    expect(result.shops).toEqual([
      expect.objectContaining({
        deptId: 613299,
        deptName: "上海虹桥天地店",
        address: "申长路 688 号",
      }),
    ]);
  });

  it("accepts array shop search results from the mini-program search endpoint", async () => {
    const orderUserId = await createMiniprogramOrderUser();
    const syncResult = await syncMiniprogramCoffeeCards(
      env.DB,
      async () =>
        encryptedMiniprogramResponse({
          code: 1,
          content: {
            planList: [
              {
                link: "/pages/index/menu?isCouponUse=true&couponNo=CK090&couponType=2",
                coffeeStockTitle: "搜索门店卡",
                stockNum: 1,
              },
            ],
          },
        }),
      { orderUserId },
    );
    const sellable = await firstGeneratedSellableForCard(syncResult.cards[0].id);

    const fetcher: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe("https://capi.lkcoffee.com/resource/m/shop/list");
      expect(await requestPayload(request)).toEqual({
        longitude: 121.36507336460822,
        latitude: 31.17091752884069,
        userLongitude: 121.36507336460822,
        userLatitude: 31.17091752884069,
        channel: "GCJ-02",
        cityId: 215,
        searchValue: "揭东开发区店",
        offSet: 0,
        pageSize: 10,
      });

      return encryptedMiniprogramResponse({
        code: 1,
        content: [
          {
            deptId: 123456,
            deptName: "揭东开发区店",
            address: "广东省揭阳市揭东区某路",
          },
        ],
      });
    };

    const result = await queryMiniprogramShopsForSellable(
      env.DB,
      fetcher,
      {
        id: sellable?.id ?? "",
        sign: sellable?.sign ?? "",
        longitude: 121.36507336460822,
        latitude: 31.17091752884069,
        cityId: 215,
        searchValue: "揭东开发区店",
      },
    );

    expect(result.shops).toEqual([
      expect.objectContaining({
        deptId: 123456,
        deptName: "揭东开发区店",
        address: "广东省揭阳市揭东区某路",
      }),
    ]);
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
    const sellable = await firstGeneratedSellableForCard(
      syncResult.cards[0].id,
    );

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
    const sellable = await firstGeneratedSellableForCard(
      syncResult.cards[0].id,
    );
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
    const sellable = await firstGeneratedSellableForCard(
      syncResult.cards[0].id,
    );

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
                productSubAttrs: [
                  { attributeId: 201, attributeName: "冰", selected: 1 },
                ],
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
            productSubAttrs: [
              { attributeId: 201, attributeName: "冰", selected: 1 },
            ],
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
    const sellable = await firstGeneratedSellableForCard(
      syncResult.cards[0].id,
    );

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
              operation: 3,
              attributeName: "热",
              step: 1,
              name: "热",
            },
          },
          cardCouponParam: {
            couponNo: "CKPRICE",
            couponType: 2,
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
            operation: 3,
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

  it("creates with the preview-selected coffee card instead of overriding it with coffeestore match", async () => {
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
              {
                link: "/pages/index/menu?isCouponUse=true&couponNo=CK004&couponType=2",
                coffeeVoucherType: 1,
                coffeeStockTitle: "瑞幸自动匹配卡",
                stockNum: 1,
              },
            ],
          },
        }),
      { orderUserId },
    );
    const sellable = await firstGeneratedSellableForCard(
      syncResult.cards[0].id,
    );
    const calls: Array<{
      url: string;
      payload: Record<string, unknown>;
      sid: string | null;
    }> = [];

    const result = await createMiniprogramOrderForSellable(
      env.DB,
      async (input, init) => {
        const request = new Request(input, init);
        const payload = await requestPayload(request);
        calls.push({
          url: request.url,
          payload,
          sid: request.headers.get("X-LK-SID"),
        });

        if (request.url.endsWith("/resource/core/v2/order/preview")) {
          return encryptedMiniprogramResponse({
            code: 1,
            content: {
              discountPrice: 0,
              couponCodeList: ["AUTO-COUPON-SHOULD-NOT-CREATE"],
              limitCouponCodeList: ["AUTO-LIMIT-SHOULD-NOT-CREATE"],
              dispatchCouponCodeList: ["AUTO-DISPATCH-SHOULD-NOT-CREATE"],
              cardCodeList: ["AUTO-MEMBER-CARD-SHOULD-NOT-CREATE"],
              cardDiscount: 15,
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
                  group: 9,
                  groupType: 2,
                  itemFromLocation: "card-zone",
                  transmission: {
                    traceId: "preview-trace",
                  },
                  matchedSaleAttributeId: 88001,
                },
              ],
            },
          });
        }

        if (request.url.endsWith("/resource/core/v2/order/coffeestore/match")) {
          return encryptedMiniprogramResponse({
            code: 1,
            content: {
              totalDiscountMoney: 24,
              productList: [
                {
                  indexId: 1,
                  productId: 5151,
                  skuCode: "SP3571-00244",
                  amount: 1,
                  cafeKuId: "CK004",
                  couponNo: "AUTO-PRODUCT-COUPON-SHOULD-NOT-CREATE",
                  coffeeVoucherType: 1,
                  processTypeDetailList: [],
                  supportChangeProcessType: 0,
                },
              ],
            },
          });
        }

        if (request.url.endsWith("/resource/core/v1/order/preCreate")) {
          return encryptedMiniprogramResponse({
            code: 7,
            busiCode: "BASE900",
            msg: "{{虹桥天地店}}确认订单后将无法更改",
            content: null,
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
      "https://capi.lkcoffee.com/resource/core/v2/order/coffeestore/match",
      "https://capi.lkcoffee.com/resource/core/v1/order/preCreate",
      "https://capi.lkcoffee.com/resource/core/v1/order/create",
      "https://capi.lkcoffee.com/resource/core/v2/pay/topay",
    ]);
    expect(calls[0].payload.productList).toEqual([
      expect.objectContaining({
        productId: 5151,
        skuCode: "SP3571-00244",
        cafeKuId: "",
        couponNo: "",
        coffeeVoucherType: 0,
      }),
    ]);
    expect(calls[1].payload.productList).toEqual([
      expect.objectContaining({
        productId: 5151,
        skuCode: "SP3571-00244",
        cafeKuId: "",
        couponNo: "",
        coffeeVoucherType: 0,
      }),
    ]);
    expect(calls[2].payload).toEqual(
      expect.objectContaining({
        deptId: "613299",
        delivery: "pick",
        eatway: "package",
        channel: "GCJ-02",
        appVersion: "5587",
        needs: null,
        priority: 2,
        blackBox: "blackbox-test",
        did: "DXHQIwTYZMEwGKGPEj3jLbuxZ5z5zde0M5ac",
        miniversion: "5587",
      }),
    );
    expect(calls[2].sid).toBe("613299");
    expect(calls[2].payload).not.toHaveProperty("shopAbTest");
    expect(calls[2].payload).not.toHaveProperty("cityId");
    expect(calls[2].payload).not.toHaveProperty("wxScene");
    expect(calls[3].payload).toEqual(
      expect.objectContaining({
        deptId: "613299",
        delivery: "pick",
        eatway: "package",
        channel: "GCJ-02",
        appVersion: "5587",
        needs: null,
        priority: 2,
        blackBox: "blackbox-test",
        did: "DXHQIwTYZMEwGKGPEj3jLbuxZ5z5zde0M5ac",
        wxScene: 1001,
        miniversion: "5587",
      }),
    );
    expect(calls[3].sid).toBe("613299");
    expect(calls[3].payload).not.toHaveProperty("shopAbTest");
    expect(calls[3].payload).not.toHaveProperty("cityId");
    expect(calls[3].payload.productList).toEqual([
      expect.objectContaining({
        productId: 5151,
        skuCode: "SP3571-00244",
        cafeKuId: "CK003",
        couponNo: "",
        coffeeVoucherType: 1,
        group: 9,
        groupType: 2,
        itemFromLocation: "card-zone",
        transmission: {
          traceId: "preview-trace",
        },
        matchedSaleAttributeId: 88001,
      }),
    ]);
    expect(calls[3].payload).toEqual(
      expect.objectContaining({
        couponCodeList: ["AUTO-COUPON-SHOULD-NOT-CREATE"],
        limitCouponCodeList: ["AUTO-LIMIT-SHOULD-NOT-CREATE"],
        dispatchCouponList: ["AUTO-DISPATCH-SHOULD-NOT-CREATE"],
        cardCodeList: ["AUTO-MEMBER-CARD-SHOULD-NOT-CREATE"],
      }),
    );
    expect(result.order).toEqual(
      expect.objectContaining({ orderId: "ORDER001" }),
    );

    const row = await env.DB.prepare(
      `SELECT status,
              luckin_order_id,
              selected_product_id,
              selected_sku_code,
              coffee_card_id,
              actual_cafe_ku_id,
              actual_coffee_card_id
			 FROM miniprogram_sellable_products
			 WHERE id = ?`,
    )
      .bind(sellable?.id ?? "")
      .first<{
        status: string;
        luckin_order_id: string;
        selected_product_id: number;
        selected_sku_code: string;
        coffee_card_id: number;
        actual_cafe_ku_id: string;
        actual_coffee_card_id: number;
      }>();
    expect(row).toEqual({
      status: "done",
      luckin_order_id: "ORDER001",
      selected_product_id: 5151,
      selected_sku_code: "SP3571-00244",
      coffee_card_id: syncResult.cards[0].id,
      actual_cafe_ku_id: "CK003",
      actual_coffee_card_id: syncResult.cards[0].id,
    });
  });

  it("keeps the selected sku and processing attributes when applying the preview-selected coffee card", async () => {
    const orderUserId = await createMiniprogramOrderUser();
    const syncResult = await syncMiniprogramCoffeeCards(
      env.DB,
      async () =>
        encryptedMiniprogramResponse({
          code: 1,
          content: {
            planList: [
              {
                link: "/pages/index/menu?isCouponUse=true&couponNo=CKATTR&couponType=2",
                coffeeVoucherType: 1,
                coffeeStockTitle: "属性卡",
                stockNum: 1,
              },
            ],
          },
        }),
      { orderUserId },
    );
    const sellable = await firstGeneratedSellableForCard(
      syncResult.cards[0].id,
    );
    const calls: Array<{ url: string; payload: Record<string, unknown> }> = [];

    await createMiniprogramOrderForSellable(
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
                  productId: 5790,
                  skuCode: "SP4210-00004",
                  amount: 1,
                  cafeKuId: "CKATTR",
                  couponNo: "",
                  coffeeVoucherType: 1,
                  processTypeDetailList: [
                    { processTypeId: 10, optionId: 100, optionName: "冰" },
                  ],
                  supportChangeProcessType: 1,
                },
              ],
            },
          });
        }

        if (request.url.endsWith("/resource/core/v2/order/coffeestore/match")) {
          return encryptedMiniprogramResponse({
            code: 1,
            content: { productList: [] },
          });
        }

        if (request.url.endsWith("/resource/core/v1/order/preCreate")) {
          return encryptedMiniprogramResponse({
            code: 1,
            content: { canCreate: true },
          });
        }

        if (request.url.endsWith("/resource/core/v1/order/create")) {
          return encryptedMiniprogramResponse({
            code: 1,
            content: {
              orderId: "ORDER-ATTR",
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
          productId: 5790,
          skuCode: "SP4210-HOT",
          productName: "热拿铁",
          amount: 1,
          processTypeDetailList: [
            { processTypeId: 10, optionId: 101, optionName: "热" },
          ],
        },
      },
    );

    expect(calls[3].payload.productList).toEqual([
      expect.objectContaining({
        productId: 5790,
        skuCode: "SP4210-HOT",
        cafeKuId: "CKATTR",
        couponNo: "",
        coffeeVoucherType: 1,
        processTypeDetailList: [
          { processTypeId: 10, optionId: 101, optionName: "热" },
        ],
        supportChangeProcessType: 1,
      }),
    ]);
  });
});

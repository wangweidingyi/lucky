import { fromHono } from "chanfana";
import { Hono } from "hono";
import OrderDetailRead from "./detail";
import QueryShopList from "./queryShopList";
import {
	CancelOrder,
	CreateOrder,
	PreviewOrder,
	QueryOrderDetailInfo,
	QueryProductDetailInfo,
	SearchProductForMcp,
	SwitchProduct,
} from "./luckinMcpRoutes";
import {
	CatalogList,
	CatalogRepairSellable,
	CatalogSync,
} from "./catalog";
import { MiniprogramCreateOrder } from "./miniprogramCreateOrder";

export const orderRouter = fromHono(new Hono());

orderRouter.post("/detail", OrderDetailRead);
orderRouter.post("/queryShopList", QueryShopList);
orderRouter.post("/searchProductForMcp", SearchProductForMcp);
orderRouter.post("/switchProduct", SwitchProduct);
orderRouter.post("/queryProductDetailInfo", QueryProductDetailInfo);
orderRouter.post("/previewOrder", PreviewOrder);
orderRouter.post("/createOrder", CreateOrder);
orderRouter.post("/miniprogramcreateOrder", MiniprogramCreateOrder);
orderRouter.post("/queryOrderDetailInfo", QueryOrderDetailInfo);
orderRouter.post("/cancelOrder", CancelOrder);
orderRouter.post("/catalog/list", CatalogList);
orderRouter.post("/catalog/sync", CatalogSync);
orderRouter.post("/catalog/repairSellable", CatalogRepairSellable);

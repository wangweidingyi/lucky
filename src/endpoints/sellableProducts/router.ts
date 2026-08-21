import { fromHono } from "chanfana";
import { Hono } from "hono";
import { SellableProductCreate } from "./sellableProductCreate";
import { SellableProductDelete } from "./sellableProductDelete";
import { SellableProductList } from "./sellableProductList";
import { SellableProductRead } from "./sellableProductRead";
import { SellableProductUpdate } from "./sellableProductUpdate";

export const sellableProductsRouter = fromHono(new Hono());

sellableProductsRouter.post("/list", SellableProductList);
sellableProductsRouter.post("/create", SellableProductCreate);
sellableProductsRouter.post("/read", SellableProductRead);
sellableProductsRouter.post("/update", SellableProductUpdate);
sellableProductsRouter.post("/delete", SellableProductDelete);

import { fromHono } from "chanfana";
import { Hono } from "hono";
import xiaDan from "./xiadan";

export const xyOrderRouter = fromHono(new Hono());
// 闲鱼接口告知已有用户下单
xyOrderRouter.post("/xiadan", xiaDan);

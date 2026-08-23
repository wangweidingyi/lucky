import { fromHono } from "chanfana";
import { Hono } from "hono";
import OrderDetailRead from "./detail";

export const orderRouter = fromHono(new Hono());

orderRouter.post("/detail", OrderDetailRead);

import { fromHono } from "chanfana";
import { Hono } from "hono";
import { OrderUserCreate } from "./orderUserCreate";
import { OrderUserDelete } from "./orderUserDelete";
import { OrderUserList } from "./orderUserList";
import { OrderUserRead } from "./orderUserRead";
import { OrderUserUpdate } from "./orderUserUpdate";

export const orderUsersRouter = fromHono(new Hono());

orderUsersRouter.post("/list", OrderUserList);
orderUsersRouter.post("/create", OrderUserCreate);
orderUsersRouter.post("/read", OrderUserRead);
orderUsersRouter.post("/update", OrderUserUpdate);
orderUsersRouter.post("/delete", OrderUserDelete);

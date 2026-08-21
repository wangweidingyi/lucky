import { z } from "zod";

export const idSchema = z.string().regex(/^[a-zA-Z0-9]{16}$/);
export const orderUserStatusSchema = z.enum(["enabled", "disabled"]);

export const orderUserRowSchema = z.object({
	id: idSchema,
	nickname: z.string(),
	token: z.string(),
	type: z.literal("lucky"),
	status: orderUserStatusSchema,
	is_delete: z.number().int(),
});

export const orderUserCreateBodySchema = z.object({
	nickname: z.string().min(1),
	token: z.string().min(1),
	type: z.literal("lucky").optional().default("lucky"),
	status: orderUserStatusSchema.optional().default("enabled"),
});

export const orderUserIdBodySchema = z.object({
	id: idSchema,
});

export const orderUserUpdateBodySchema = orderUserIdBodySchema.extend({
	nickname: z.string().min(1).optional(),
	token: z.string().min(1).optional(),
	type: z.literal("lucky").optional(),
	status: orderUserStatusSchema.optional(),
});

export type OrderUserRow = z.infer<typeof orderUserRowSchema>;

export async function findActiveOrderUser(db: D1Database, id: string) {
	return db
		.prepare("SELECT * FROM lucky_order_users WHERE id = ? AND is_delete = 0")
		.bind(id)
		.first<OrderUserRow>();
}

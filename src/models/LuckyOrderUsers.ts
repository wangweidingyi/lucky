import { z } from "zod";

export const idSchema = z.string().regex(/^[a-zA-Z0-9]{10}$/);
export const orderUserStatusSchema = z.enum(["enabled", "disabled"]);
export const orderUserAuthModeSchema = z.enum(["token", "miniprogram"]);
const nullableTextSchema = z.string().min(1).nullable();
const optionalNullableTextSchema = nullableTextSchema.optional().default(null);

export const orderUserRowSchema = z.object({
    id: idSchema,
    nickname: z.string(),
    token: z.string(),
    type: z.literal("lucky"),
    status: orderUserStatusSchema,
    auth_mode: orderUserAuthModeSchema,
    uid: z.string().nullable(),
    openid: z.string().nullable(),
    black_box: z.string().nullable(),
    notify_code: z.string().nullable(),
    csid: z.string().nullable(),
    pay_type: z.string().nullable(),
    miniprogram_version: z.string().nullable(),
    aes_key: z.string().nullable(),
    base_url: z.string().nullable(),
    cookie: z.string().nullable(),
    is_delete: z.number().int(),
});

export const orderUserCreateBodySchema = z.object({
    nickname: z.string().min(1),
    token: z.string().min(1),
    type: z.literal("lucky").optional().default("lucky"),
    status: orderUserStatusSchema.optional().default("enabled"),
    auth_mode: orderUserAuthModeSchema.optional().default("token"),
    uid: optionalNullableTextSchema,
    openid: optionalNullableTextSchema,
    black_box: optionalNullableTextSchema,
    notify_code: optionalNullableTextSchema,
    csid: optionalNullableTextSchema,
    pay_type: optionalNullableTextSchema,
    miniprogram_version: optionalNullableTextSchema,
    aes_key: optionalNullableTextSchema,
    base_url: optionalNullableTextSchema,
    cookie: optionalNullableTextSchema,
});

export const orderUserIdBodySchema = z.object({
    id: idSchema,
});

export const orderUserUpdateBodySchema = orderUserIdBodySchema.extend({
    nickname: z.string().min(1).optional(),
    token: z.string().min(1).optional(),
    type: z.literal("lucky").optional(),
    status: orderUserStatusSchema.optional(),
    auth_mode: orderUserAuthModeSchema.optional(),
    uid: nullableTextSchema.optional(),
    openid: nullableTextSchema.optional(),
    black_box: nullableTextSchema.optional(),
    notify_code: nullableTextSchema.optional(),
    csid: nullableTextSchema.optional(),
    pay_type: nullableTextSchema.optional(),
    miniprogram_version: nullableTextSchema.optional(),
    aes_key: nullableTextSchema.optional(),
    base_url: nullableTextSchema.optional(),
    cookie: nullableTextSchema.optional(),
});

export type OrderUserRow = z.infer<typeof orderUserRowSchema>;

export async function findActiveOrderUser(db: D1Database, id: string) {
    return db
        .prepare("SELECT * FROM lucky_order_users WHERE id = ? AND is_delete = 0")
        .bind(id)
        .first<OrderUserRow>();
}

import { z } from "zod";

export const miniprogramIdSchema = z.string().regex(/^[a-zA-Z0-9]{10}$/);
export const miniprogramOrderUserStatusSchema = z.enum(["enabled", "disabled"]);

const nullableTextSchema = z.string().min(1).nullable();
const optionalNullableTextSchema = nullableTextSchema.optional().default(null);

export const miniprogramOrderUserRowSchema = z.object({
  id: miniprogramIdSchema,
  nickname: z.string(),
  status: miniprogramOrderUserStatusSchema,
  uid: z.string(),
  openid: z.string().nullable(),
  black_box: z.string().nullable(),
  device_id: z.string().nullable().optional(),
  notify_code: z.string().nullable(),
  csid: z.string().nullable(),
  pay_type: z.string().nullable(),
  miniprogram_version: z.string(),
  aes_key: z.string(),
  base_url: z.string(),
  cookie: z.string().nullable(),
  is_delete: z.number().int(),
});

export const miniprogramOrderUserCreateBodySchema = z.object({
  nickname: z.string().min(1),
  status: miniprogramOrderUserStatusSchema.optional().default("enabled"),
  uid: z.string().min(1),
  openid: optionalNullableTextSchema,
  black_box: optionalNullableTextSchema,
  device_id: optionalNullableTextSchema,
  notify_code: optionalNullableTextSchema,
  csid: optionalNullableTextSchema,
  pay_type: optionalNullableTextSchema,
  miniprogram_version: z.string().min(1).optional().default("5587"),
  aes_key: z.string().min(1).optional().default("CJQjAc1hYieC4QYb"),
  base_url: z.string().min(1).optional().default("https://capi.lkcoffee.com"),
  cookie: optionalNullableTextSchema,
});

export const miniprogramOrderUserIdBodySchema = z.object({
  id: miniprogramIdSchema,
});

export const miniprogramOrderUserUpdateBodySchema =
  miniprogramOrderUserIdBodySchema.extend({
    nickname: z.string().min(1).optional(),
    status: miniprogramOrderUserStatusSchema.optional(),
    uid: z.string().min(1).optional(),
    openid: nullableTextSchema.optional(),
    black_box: nullableTextSchema.optional(),
    device_id: nullableTextSchema.optional(),
    notify_code: nullableTextSchema.optional(),
    csid: nullableTextSchema.optional(),
    pay_type: nullableTextSchema.optional(),
    miniprogram_version: z.string().min(1).optional(),
    aes_key: z.string().min(1).optional(),
    base_url: z.string().min(1).optional(),
    cookie: nullableTextSchema.optional(),
  });

export type MiniprogramOrderUserRow = z.infer<
  typeof miniprogramOrderUserRowSchema
>;

export async function findActiveMiniprogramOrderUser(
  db: D1Database,
  id: string,
) {
  return db
    .prepare(
      `SELECT *
			 FROM miniprogram_order_users
			 WHERE id = ? AND status = 'enabled' AND is_delete = 0`,
    )
    .bind(id)
    .first<MiniprogramOrderUserRow>();
}

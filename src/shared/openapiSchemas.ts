import { extendZodWithOpenApi } from "chanfana";
import { z } from "zod";

extendZodWithOpenApi(z);

export const openApiJsonObjectSchema = z.record(z.any()).openapi({
	type: "object",
	additionalProperties: true,
});

export const openApiJsonValueSchema = z.any().openapi({
	type: "object",
	additionalProperties: true,
});

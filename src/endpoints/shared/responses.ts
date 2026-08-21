import type { AppContext } from "../../types";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function ok(
	c: AppContext,
	result: unknown,
	status: ContentfulStatusCode = 200,
) {
	return c.json({ success: true, result }, status);
}

export function fail(
	c: AppContext,
	message: string,
	status: ContentfulStatusCode = 400,
) {
	return c.json(
		{
			success: false,
			errors: [{ code: status, message }],
		},
		status,
	);
}

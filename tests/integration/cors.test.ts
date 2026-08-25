import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const allowedOrigins = [
	"http://localhost:5173",
	"http://localhost:5174",
	"http://localhost:5175",
	"http://localhost:5176",
	"https://lk.maerai.com",
];

describe("CORS", () => {
	it.each(allowedOrigins)("allows %s", async (origin) => {
		const response = await SELF.fetch("http://local.test/lkadmin/login", {
			method: "OPTIONS",
			headers: {
				Origin: origin,
				"Access-Control-Request-Method": "POST",
				"Access-Control-Request-Headers": "content-type,authorization",
			},
		});

		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-origin")).toBe(origin);
		expect(response.headers.get("access-control-allow-methods")).toContain(
			"POST",
		);
		expect(
			response.headers.get("access-control-allow-headers")?.toLowerCase(),
		).toContain("content-type");
	});

	it("does not allow unknown origins", async () => {
		const response = await SELF.fetch("http://local.test/lkadmin/login", {
			method: "OPTIONS",
			headers: {
				Origin: "https://example.com",
				"Access-Control-Request-Method": "POST",
			},
		});

		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
	});

	it("adds CORS headers to normal responses for allowed origins", async () => {
		const response = await SELF.fetch("http://local.test/lkadmin/login", {
			method: "POST",
			headers: {
				Origin: "https://lk.maerai.com",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ token: "wrong" }),
		});

		expect(response.status).toBe(401);
		expect(response.headers.get("access-control-allow-origin")).toBe(
			"https://lk.maerai.com",
		);
	});
});

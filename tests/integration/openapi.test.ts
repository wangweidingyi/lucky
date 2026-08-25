import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("OpenAPI documentation", () => {
	it("serves Swagger and OpenAPI only for local development hosts", async () => {
		const localDocs = await SELF.fetch("http://localhost/");
		expect(localDocs.status).toBe(200);
		expect(await localDocs.text()).toContain("SwaggerUI");

		const localSchema = await SELF.fetch("http://localhost/openapi.json");
		expect(localSchema.status).toBe(200);
		expect(localSchema.headers.get("content-type")).toContain("application/json");
		const schema = (await localSchema.json()) as {
			openapi: string;
			paths: Record<string, unknown>;
		};
		expect(schema.openapi).toMatch(/^3\./);
		expect(schema.paths).toHaveProperty("/order/queryShopList");

		const deployedDocs = await SELF.fetch("https://lucky.example.com/");
		expect(deployedDocs.status).toBe(404);

		const deployedSchema = await SELF.fetch(
			"https://lucky.example.com/openapi.json",
		);
		expect(deployedSchema.status).toBe(404);
	});
});

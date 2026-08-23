import { z } from "zod";
import {
	createLuckinMcpToolRoute,
	mcpForwardBaseBodySchema,
} from "./luckinMcp";

const productListItemSchema = z.object({
	amount: z.number().int().positive(),
	productId: z.number().int(),
	skuCode: z.string().min(1),
});

export const searchProductForMcpBodySchema = mcpForwardBaseBodySchema.extend({
	deptId: z.number().int(),
	query: z.string().min(1),
});

export const switchProductBodySchema = mcpForwardBaseBodySchema.extend({
	deptId: z.number().int(),
	productId: z.number().int(),
	skuCode: z.string().min(1),
	attrOperationParam: z.object({
		attributeId: z.number().int(),
		subAttr: z.object({
			attributeId: z.number().int(),
			operation: z.number().int(),
		}),
	}),
	amount: z.number().int().positive(),
});

export const queryProductDetailInfoBodySchema = mcpForwardBaseBodySchema.extend({
	deptId: z.number().int(),
	productId: z.number().int(),
});

export const previewOrderBodySchema = mcpForwardBaseBodySchema.extend({
	deptId: z.number().int(),
	productList: z.array(productListItemSchema).min(1),
});

export const createOrderBodySchema = mcpForwardBaseBodySchema.extend({
	deptId: z.number().int(),
	productList: z.array(productListItemSchema).min(1),
	longitude: z.number(),
	latitude: z.number(),
	couponCodeList: z.array(z.string()).optional(),
	remark: z.string().optional(),
});

export const orderIdToolBodySchema = mcpForwardBaseBodySchema.extend({
	orderId: z.string().min(1),
});

export const SearchProductForMcp = createLuckinMcpToolRoute(
	"searchProductForMcp",
	searchProductForMcpBodySchema,
	"Forward Luckin product search with the order user's token",
);

export const SwitchProduct = createLuckinMcpToolRoute(
	"switchProduct",
	switchProductBodySchema,
	"Forward Luckin product attribute switching with the order user's token",
);

export const QueryProductDetailInfo = createLuckinMcpToolRoute(
	"queryProductDetailInfo",
	queryProductDetailInfoBodySchema,
	"Forward Luckin product detail lookup with the order user's token",
);

export const PreviewOrder = createLuckinMcpToolRoute(
	"previewOrder",
	previewOrderBodySchema,
	"Forward Luckin order preview with the order user's token",
);

export const CreateOrder = createLuckinMcpToolRoute(
	"createOrder",
	createOrderBodySchema,
	"Forward Luckin order creation with the order user's token",
);

export const QueryOrderDetailInfo = createLuckinMcpToolRoute(
	"queryOrderDetailInfo",
	orderIdToolBodySchema,
	"Forward Luckin order detail lookup with the order user's token",
);

export const CancelOrder = createLuckinMcpToolRoute(
	"cancelOrder",
	orderIdToolBodySchema,
	"Forward Luckin order cancellation with the order user's token",
);

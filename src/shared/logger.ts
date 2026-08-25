type LogLevel = "debug" | "info" | "warn" | "error";

const sensitiveKeys = new Set([
	"authorization",
	"cookie",
	"setcookie",
	"token",
	"secret",
	"password",
	"passwd",
	"aeskey",
	"blackbox",
	"notifycode",
	"openid",
	"session",
]);

type LogData = Record<string, unknown>;

export const appLogger = {
	debug(scope: string, event: string, data: LogData = {}) {
		writeLog("debug", scope, event, data);
	},
	info(scope: string, event: string, data: LogData = {}) {
		writeLog("info", scope, event, data);
	},
	warn(scope: string, event: string, data: LogData = {}) {
		writeLog("warn", scope, event, data);
	},
	error(scope: string, event: string, data: LogData = {}) {
		writeLog("error", scope, event, data);
	},
};

function writeLog(
	level: LogLevel,
	scope: string,
	event: string,
	data: LogData,
) {
	const entry = {
		level,
		scope,
		event,
		location: inferCallerLocation(),
		timestamp: new Date().toISOString(),
		data: sanitizeLogValue(data),
	};

	console[level]("[lucky]", JSON.stringify(entry));
}

export function sanitizeLogValue(value: unknown, key = ""): unknown {
	if (isSensitiveKey(key)) {
		return value ? "[redacted]" : value;
	}

	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack,
		};
	}

	if (Array.isArray(value)) {
		return value.map((item) => sanitizeLogValue(item));
	}

	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>).map(([itemKey, item]) => [
				itemKey,
				sanitizeLogValue(item, itemKey),
			]),
		);
	}

	return value;
}

function isSensitiveKey(key: string) {
	return sensitiveKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
}

function inferCallerLocation() {
	const stack = new Error().stack?.split("\n").slice(1) ?? [];
	const frame = stack.find((line) => {
		const normalized = line.trim();

		return (
			!normalized.includes("src/shared/logger.ts") &&
			!normalized.includes("shared/logger.ts") &&
			!normalized.includes("writeLog") &&
			!normalized.includes("inferCallerLocation") &&
			!normalized.includes("Object.debug") &&
			!normalized.includes("Object.info") &&
			!normalized.includes("Object.warn") &&
			!normalized.includes("Object.error") &&
			!normalized.includes("logMiniprogram") &&
			!normalized.includes("logCouponSync")
		);
	});

	return frame ? normalizeStackFrame(frame) : "unknown";
}

function normalizeStackFrame(frame: string) {
	const trimmed = frame.trim().replace(/^at\s+/, "");
	const srcIndex = trimmed.indexOf("/src/");
	const testsIndex = trimmed.indexOf("/tests/");
	const index =
		srcIndex >= 0
			? srcIndex + 1
			: testsIndex >= 0
				? testsIndex + 1
				: -1;

	return index >= 0 ? trimmed.slice(index) : trimmed;
}

const alphabet =
	"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateId(length = 16) {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);

	return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

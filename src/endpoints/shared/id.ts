import { customAlphabet } from "nanoid";

const alphabet =
	"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const nanoid = customAlphabet(alphabet, 16);

export function generateId(length = 16) {
	return nanoid(length);
}

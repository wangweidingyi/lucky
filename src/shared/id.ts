import { customAlphabet } from "nanoid";

const alphabet =
	"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const nanoid = customAlphabet(alphabet, 10);

export function generateId(length = 10) {
	return nanoid(length);
}

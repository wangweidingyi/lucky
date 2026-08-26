import { customAlphabet } from "nanoid";

const alphabet =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const nanoid = customAlphabet(alphabet, 10);
const miniprogramSellableAlphabet =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-";
const miniprogramSellableNanoid = customAlphabet(
  miniprogramSellableAlphabet,
  31,
);

export function generateId(length = 10) {
  return nanoid(length);
}

export function generateMiniprogramSellableId() {
  return miniprogramSellableNanoid();
}

export function generateMiniprogramSellableSign() {
  return miniprogramSellableNanoid();
}

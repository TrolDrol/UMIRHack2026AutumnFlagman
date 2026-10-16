const pattern = /^(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?$/;
export function thousandths(value: string): bigint {
  if (!pattern.test(value))
    throw new Error(
      "Введите количество без запятой, до трёх знаков после точки",
    );
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}
export function quantity(value: string): string {
  const n = thousandths(value);
  return `${n / 1000n}.${String(n % 1000n).padStart(3, "0")}`;
}
export function displayQuantity(value: string): string {
  return value.replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
}
export const units = { g: "г", ml: "мл", pcs: "шт." } as const;

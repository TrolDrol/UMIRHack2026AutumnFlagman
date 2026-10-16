export function nextDeliveryNumber(existing: string[]) {
  let maximum = 0n;
  for (const number of existing) {
    const match = /^SUP-(\d+)$/.exec(number.trim());
    if (match && BigInt(match[1]) > maximum) maximum = BigInt(match[1]);
  }
  return `SUP-${String(maximum + 1n).padStart(4, "0")}`;
}

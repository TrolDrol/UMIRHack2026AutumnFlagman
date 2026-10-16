export const timeZone = "Europe/Moscow";
const inputFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function localComponents(value: string): string {
  const parts = Object.fromEntries(
    inputFormatter.formatToParts(new Date(value)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
export function moscowToUtc(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?$/.test(value))
    throw new Error("Укажите дату и время (Москва)");
  const [whole, fraction] = value.split(".");
  const normalized = whole.length === 16 ? `${whole}:00` : whole;
  const target = Date.parse(`${normalized}Z`);
  if (!Number.isFinite(target)) throw new Error("Некорректная дата");
  let estimate = target;
  for (let i = 0; i < 3; i++) {
    const local = localComponents(new Date(estimate).toISOString());
    estimate += target - Date.parse(`${local}Z`);
  }
  const utc = new Date(estimate).toISOString();
  if (localComponents(utc) !== normalized)
    throw new Error("Некорректная дата или неоднозначное московское время");
  return fraction ? utc.replace(/\.000Z$/, `.${fraction}Z`) : utc;
}
export function utcToMoscow(value: string): string {
  const fraction = /\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/.exec(value)?.[1];
  return localComponents(value) + (fraction ? `.${fraction}` : "");
}
export function dateTime(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("ru-RU", {
        timeZone,
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(value))
    : "—";
}
export function remainingLabel(seconds: number): string {
  if (seconds <= 0) return "Срок достигнут";
  const minutes = Math.ceil(seconds / 60);
  return minutes >= 60
    ? `Осталось ${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
    : `Осталось ${minutes} мин`;
}

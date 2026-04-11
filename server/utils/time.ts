import { parse } from "date-fns";

const DATE_PATTERNS = [
  "yyyy年MM月dd日 HH:mm:ss",
  "yyyy-MM-dd HH:mm:ss",
  "yyyy/MM/dd HH:mm:ss",
  "yyyy-MM-dd",
  "yyyy/MM/dd",
];

export function parseChineseDateToUnix(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  for (const pattern of DATE_PATTERNS) {
    const parsed = parse(normalized, pattern, new Date());
    if (!Number.isNaN(parsed.getTime())) {
      return Math.floor(parsed.getTime() / 1000);
    }
  }

  const fallback = new Date(normalized);
  if (Number.isNaN(fallback.getTime())) {
    return null;
  }

  return Math.floor(fallback.getTime() / 1000);
}

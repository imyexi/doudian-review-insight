const DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatShortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return DATE_FORMATTER.format(date);
}

export function formatTimestamp(value: number | null | undefined): string {
  if (!value) {
    return "--";
  }

  return DATE_TIME_FORMATTER.format(new Date(value * 1000));
}

export function formatDecimal(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "0.00";
  }

  return value.toFixed(2);
}

export function formatPercent(numerator: number, denominator: number): string {
  if (denominator <= 0) {
    return "0%";
  }

  return `${Math.round((numerator / denominator) * 100)}%`;
}

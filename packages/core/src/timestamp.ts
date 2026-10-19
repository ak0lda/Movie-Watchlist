const UTC_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Strict `YYYY-MM-DDTHH:mm:ss.sssZ`; rejects offsets, missing millis and impossible dates. */
export function isUtcIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_ISO_PATTERN.test(value)) return false;
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString() === value;
}

export function toUtcIso(date: Date): string {
  return date.toISOString();
}

/** Negative if `a` is earlier than `b`. */
export function compareTimestamps(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b);
}

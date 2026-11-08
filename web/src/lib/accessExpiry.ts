// An account's end date is picked as a calendar day in the admin's time zone
// and stored as the last millisecond of that day, so access lasts through the
// whole chosen day.

/** The `<input type="date">` value for a stored end date; "" when none. */
export function accessExpiryInputValue(instant: string | null | undefined): string {
  if (!instant) return "";
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** The instant to store for a picked day; null for an empty or invalid value. */
export function accessExpiryInstant(day: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const at = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/** Whether a picked day has already ended. */
export function accessExpiryPassed(day: string, now = new Date()): boolean {
  const instant = accessExpiryInstant(day);
  return instant !== null && new Date(instant).getTime() <= now.getTime();
}

/** A readable end date, or the given text when the account does not expire. */
export function formatAccessExpiry(instant: string | null | undefined, none: string): string {
  if (!instant) return none;
  const at = new Date(instant);
  return Number.isNaN(at.getTime()) ? none : at.toLocaleDateString();
}

export const ACCESS_EXPIRY_PASSED_MESSAGE =
  "Wähle ein Enddatum in der Zukunft oder schalte die Anmeldung für dieses Konto aus.";

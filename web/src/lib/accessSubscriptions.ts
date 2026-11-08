import type { AdminUser } from "@/api/types";

// An account's "Abo" is its access end date (access_expires_at). Accounts
// without one have unlimited access.

/** An end date within this many days counts as running out soon. */
export const ACCESS_EXPIRING_SOON_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessSubscriptionState = "expired" | "soon" | "active" | "none";

export const ACCESS_SUBSCRIPTION_STATES: readonly AccessSubscriptionState[] = [
  "soon",
  "expired",
  "active",
  "none",
];

export const ACCESS_SUBSCRIPTION_LABELS: Record<AccessSubscriptionState, string> = {
  expired: "Abgelaufen",
  soon: "Läuft bald ab",
  active: "Abo aktiv",
  none: "Kein Abo",
};

export interface AccessSubscription {
  state: AccessSubscriptionState;
  /** Whole days left until the end date; null for accounts without one. */
  daysLeft: number | null;
  expiresAt: Date | null;
}

export interface AccessSubscriptionRow extends AccessSubscription {
  user: AdminUser;
}

const STATE_ORDER: Record<AccessSubscriptionState, number> = {
  expired: 0,
  soon: 1,
  active: 2,
  none: 3,
};

/** The subscription state of one account's access end date. */
export function accessSubscriptionOf(
  accessExpiresAt: string | null | undefined,
  now = new Date(),
): AccessSubscription {
  const at = accessExpiresAt ? new Date(accessExpiresAt) : null;
  if (at === null || Number.isNaN(at.getTime())) {
    return { state: "none", daysLeft: null, expiresAt: null };
  }
  const remaining = at.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(remaining / DAY_MS));
  const state: AccessSubscriptionState =
    remaining <= 0 ? "expired" : daysLeft <= ACCESS_EXPIRING_SOON_DAYS ? "soon" : "active";
  return { state, daysLeft, expiresAt: at };
}

/** "noch 5 Tage", "beendet" or "unbefristet". */
export function accessSubscriptionRemainingLabel(subscription: AccessSubscription): string {
  if (subscription.state === "none") return "unbefristet";
  if (subscription.state === "expired") return "beendet";
  if (subscription.daysLeft === 1) return "noch 1 Tag";
  return `noch ${subscription.daysLeft} Tage`;
}

/** How many accounts are in each state. */
export function countAccessSubscriptions(
  users: AdminUser[],
  now = new Date(),
): Record<AccessSubscriptionState, number> {
  const counts = { expired: 0, soon: 0, active: 0, none: 0 };
  for (const user of users) counts[accessSubscriptionOf(user.access_expires_at, now).state] += 1;
  return counts;
}

/**
 * Sorts accounts by their access end date: ended first, then the ones running
 * out soonest, then accounts without an end date by name.
 */
export function classifyAccessSubscriptions(
  users: AdminUser[],
  now = new Date(),
): AccessSubscriptionRow[] {
  const rows = users.map(
    (user): AccessSubscriptionRow => ({
      user,
      ...accessSubscriptionOf(user.access_expires_at, now),
    }),
  );
  return rows.sort((a, b) => {
    const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (byState !== 0) return byState;
    if (a.expiresAt && b.expiresAt) return a.expiresAt.getTime() - b.expiresAt.getTime();
    return a.user.username.localeCompare(b.user.username);
  });
}

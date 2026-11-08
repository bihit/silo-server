import { Badge } from "@/components/ui/badge";
import {
  ACCESS_SUBSCRIPTION_LABELS,
  type AccessSubscriptionState,
} from "@/lib/accessSubscriptions";

/** AccessSubscriptionBadge shows an account's access end date state. */
export function AccessSubscriptionBadge({ state }: { state: AccessSubscriptionState }) {
  const label = ACCESS_SUBSCRIPTION_LABELS[state];
  switch (state) {
    case "expired":
      return <Badge variant="destructive">{label}</Badge>;
    case "soon":
      return (
        <Badge className="border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400">
          {label}
        </Badge>
      );
    case "active":
      return (
        <Badge
          variant="outline"
          className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        >
          {label}
        </Badge>
      );
    case "none":
      return <Badge variant="secondary">{label}</Badge>;
  }
}

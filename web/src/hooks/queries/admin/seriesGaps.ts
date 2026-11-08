import { useQuery } from "@tanstack/react-query";
import { captureProfileRequestContext, StaleApiRequestContextError } from "@/api/client";
import { adminAuthorityScope } from "@/api/v2/adminAuthority";
import { listAdminSeriesGaps } from "@/api/v2/adminSeriesGaps";
import { adminKeys } from "@/hooks/queries/keys";

/** Series whose present episodes leave numbering gaps. */
export function useAdminSeriesGaps() {
  const context = captureProfileRequestContext();
  return useQuery({
    queryKey: [...adminKeys.seriesGaps(), adminAuthorityScope(context)],
    queryFn: () => {
      const current = captureProfileRequestContext();
      if (!current) throw new StaleApiRequestContextError();
      return listAdminSeriesGaps(current);
    },
    enabled: context !== null,
    staleTime: 60_000,
  });
}

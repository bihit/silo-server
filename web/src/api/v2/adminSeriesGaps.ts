import type { ProfileRequestContextSnapshot } from "@/api/client";
import { requireAdminAuthority } from "./adminAuthority";
import { v2, type V2Result } from "./request";

export type AdminSeriesGapsReport = V2Result<"GET /api/v2/admin/series-gaps">;
export type AdminSeriesGap = AdminSeriesGapsReport["items"][number];
export type AdminSeriesGapSeason = AdminSeriesGap["seasons"][number];
export type AdminSeriesGapsTMDB = AdminSeriesGapsReport["tmdb"];

export async function listAdminSeriesGaps(context: ProfileRequestContextSnapshot) {
  requireAdminAuthority(context);
  const result = await v2("GET /api/v2/admin/series-gaps", { profileContext: context });
  requireAdminAuthority(context);
  return result;
}

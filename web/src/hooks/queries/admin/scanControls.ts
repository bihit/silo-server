import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  captureProfileRequestContext,
  isCapturedProfileAuthorityActive,
  StaleApiRequestContextError,
  type ProfileRequestContextSnapshot,
} from "@/api/client";
import { v2 } from "@/api/v2/request";
import { adminKeys } from "../keys";

type ScanIntent = { id: number; profileContext: ProfileRequestContextSnapshot };
function captureIntent(id: number): ScanIntent {
  const profileContext = captureProfileRequestContext();
  if (!profileContext) throw new StaleApiRequestContextError();
  return { id, profileContext };
}
function useScanCommand(cancel: boolean) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    retry: false,
    mutationFn: async ({ id, profileContext }: ScanIntent) =>
      cancel
        ? v2("POST /api/v2/scan/cancel", {
            body: { library_id: String(id) },
            profileContext,
            retryAuthentication: false,
          })
        : v2("POST /api/v2/scan", {
            body: { library_id: String(id) },
            profileContext,
            retryAuthentication: false,
          }),
    onSuccess: (_result, intent) => {
      if (!isCapturedProfileAuthorityActive(intent.profileContext)) return;
      toast.success(cancel ? "Abbruch der Scans angefordert" : "Vollständiger Scan gestartet");
      if (cancel)
        void queryClient.invalidateQueries({ queryKey: adminKeys.libraryMatchQueueStatuses() });
    },
    onError: (error, intent) => {
      if (!isCapturedProfileAuthorityActive(intent.profileContext)) return;
      toast.error(
        error instanceof Error
          ? error.message
          : cancel
            ? "Scans konnten nicht abgebrochen werden"
            : "Scan fehlgeschlagen",
      );
    },
  });
  return {
    ...mutation,
    variables: mutation.variables?.id,
    mutate: (id: number) => {
      let intent: ScanIntent;
      try {
        intent = captureIntent(id);
      } catch {
        toast.error("Wähle vor dem Scannen ein Administratorprofil.");
        return;
      }
      mutation.mutate(intent);
    },
    mutateAsync: (id: number) => mutation.mutateAsync(captureIntent(id)),
  };
}
export function useScanLibrary() {
  return useScanCommand(false);
}
export function useCancelLibraryScans() {
  return useScanCommand(true);
}

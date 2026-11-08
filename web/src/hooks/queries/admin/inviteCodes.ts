import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { v2, type V2Result } from "@/api/v2/request";
import type {
  CreateInviteCodeRequest,
  UpdateInviteCodeRequest,
  TopUpInviteCodeRequest,
} from "@/api/types";
import { adminKeys } from "../keys";
import { toast } from "sonner";

export type InviteCode = V2Result<"GET /api/v2/admin/invite-codes">["items"][number];

const ADMIN_STALE_TIME = 30_000;

export function useAdminInviteCodes() {
  const query = useInfiniteQuery({
    queryKey: adminKeys.inviteCodes(),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      v2("GET /api/v2/admin/invite-codes", { query: { limit: 50, cursor: pageParam } }),
    getNextPageParam: (page) => (page.page?.has_more ? page.page.next_cursor : undefined),
    staleTime: ADMIN_STALE_TIME,
  });
  return { ...query, data: query.data?.pages.flatMap((page) => page.items) };
}

export function useCreateInviteCode() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (body: CreateInviteCodeRequest & { code: string }) =>
      v2("POST /api/v2/admin/invite-codes", {
        body,
        retryAuthentication: false,
      }),
    onSuccess: () => {
      toast.success("Einladungscode erstellt");
      queryClient.invalidateQueries({ queryKey: adminKeys.inviteCodes() });
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Einladungscode konnte nicht erstellt werden",
      );
    },
  });
}

export function useUpdateInviteCode() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: ({ id, body }: { id: string; body: UpdateInviteCodeRequest }) =>
      v2("PUT /api/v2/admin/invite-codes/{id}", { path: { id }, body, retryAuthentication: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.inviteCodes() });
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Einladungscode konnte nicht geändert werden",
      );
    },
  });
}

export function useTopUpInviteCode() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: ({ id, body }: { id: string; body: TopUpInviteCodeRequest }) =>
      v2("POST /api/v2/admin/invite-codes/{id}/top-up", {
        path: { id },
        body,
        retryAuthentication: false,
      }),
    onSuccess: () => {
      toast.success("Einladungscode aufgestockt");
      queryClient.invalidateQueries({ queryKey: adminKeys.inviteCodes() });
    },
    onError: (err) => {
      toast.error(
        "Prüfe die aktuelle maximale Nutzung des Codes, bevor du erneut aufstockst. " +
          (err instanceof Error ? err.message : "Das Ergebnis konnte nicht bestätigt werden."),
      );
      void queryClient.invalidateQueries({ queryKey: adminKeys.inviteCodes() });
    },
  });
}

export function useDeleteInviteCode() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (id: string) =>
      v2("DELETE /api/v2/admin/invite-codes/{id}", { path: { id }, retryAuthentication: false }),
    onSuccess: () => {
      toast.success("Einladungscode gelöscht");
      queryClient.invalidateQueries({ queryKey: adminKeys.inviteCodes() });
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Einladungscode konnte nicht gelöscht werden",
      );
    },
  });
}

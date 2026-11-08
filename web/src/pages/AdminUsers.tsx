import { useState, useId, useMemo, useRef } from "react";
import { flushSync } from "react-dom";
import type { FormEvent, ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import type { AdminUser, CreateUserRequest } from "@/api/types";
import {
  useAdminUsers,
  useCreateUser,
  useAdminUserCapabilities,
  useAdminPolicyDefaults,
  useViewerIsOwner,
} from "@/hooks/queries/admin/users";
import { accountRoleLabel, canManageAccount, canViewAsAccount } from "@/lib/accountOwner";
import { useAdminServerSettings } from "@/hooks/queries/admin/settings";
import { useAdminLibraries } from "@/hooks/queries/admin/libraries";
import { useAccessGroups } from "@/hooks/queries/admin/accessGroups";
import {
  PolicyAccessFields,
  PolicyLimitFields,
  effectiveAccessGroupID,
  policyCreateFields,
  policyDefaultSource,
  policyInheritHints,
  policyStateFromUser,
  type LimitPolicyKey,
} from "@/components/UserPolicyFields";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AdminUserImpersonationDialog } from "@/components/AdminUserImpersonationDialog";
import { PageHeader } from "@/components/page/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  History,
  UserRound,
  Plus,
  Pencil,
  Trash2,
  Settings2,
  Search,
  X,
} from "lucide-react";
import { AdminUserDeleteDialog } from "@/components/AdminUserDeleteDialog";
import { useAuth } from "@/hooks/useAuth";
import {
  adminUserScope,
  captureAdminUserAuthority,
  getAdminUser,
  type AdminUserEditor,
} from "@/api/v2/adminUsers";
import { userDetailTabSearch } from "./admin-users/detail/userDetailTabs";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import InvitationsTab from "./admin-settings/InvitationsTab";
import InviteCodesTab from "./admin-settings/InviteCodesTab";
import {
  PERMISSION_MARKER_EDIT,
  PERMISSION_METADATA_CURATION,
  hasAssignedPermission,
  setAssignedPermission,
} from "@/lib/permissions";
import { formatDateTime as formatDateTimePreferred } from "@/lib/datetime";
import { INVALID_EMAIL_MESSAGE, isValidEmail } from "@/lib/email";
import { newPasswordProblem, passwordErrorMessage } from "@/lib/newPassword";
import {
  ACCESS_EXPIRY_PASSED_MESSAGE,
  accessExpiryInstant,
  accessExpiryPassed,
} from "@/lib/accessExpiry";
import {
  ACCESS_EXPIRING_SOON_DAYS,
  ACCESS_SUBSCRIPTION_LABELS,
  ACCESS_SUBSCRIPTION_STATES,
  accessSubscriptionOf,
  accessSubscriptionRemainingLabel,
  countAccessSubscriptions,
  type AccessSubscriptionState,
} from "@/lib/accessSubscriptions";
import { AccessSubscriptionBadge } from "@/components/admin/AccessSubscriptionBadge";

const PAGE_SIZE_OPTIONS = ["25", "50", "100"] as const;
type UserSortField =
  | "username"
  | "email"
  | "role"
  | "enabled"
  | "access_expires_at"
  | "created_at"
  | "last_active_at";
type SortDirection = "asc" | "desc";

// Tab ids are a URL contract: other pages deep-link here (General settings
// points at ?tab=invite-codes), so reuse the trigger values verbatim.
const ADMIN_USERS_TABS = ["users", "invitations", "invite-codes"] as const;
type AdminUsersTab = (typeof ADMIN_USERS_TABS)[number];

function normalizeAdminUsersTab(value: string | null): AdminUsersTab {
  return ADMIN_USERS_TABS.includes(value as AdminUsersTab) ? (value as AdminUsersTab) : "users";
}

export default function AdminUsers() {
  useAuth();
  return <AdminUsersPage key={adminUserScope()} />;
}
function AdminUsersPage() {
  const usersQuery = useAdminUsers();
  const { data: users = [], isLoading } = usersQuery;
  const viewerId = useAuth().user?.id;
  const viewerIsOwner = useViewerIsOwner(viewerId);
  const capabilities = useAdminUserCapabilities();
  const available = capabilities.data?.available === true;
  const [authority] = useState(captureAdminUserAuthority);
  const [actionError, setActionError] = useState("");
  const busy = useRef(false);
  const formBusy = useRef(false);
  const { data: serverSettings } = useAdminServerSettings();
  const signupsEnabled = serverSettings?.["signup.enabled"] === "true";
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = normalizeAdminUsersTab(searchParams.get("tab"));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<AdminUserEditor | null>(null);
  const [impersonatingUser, setImpersonatingUser] = useState<AdminUser | null>(null);
  const [search, setSearch] = useState("");
  // "all", "none" (regular accounts outside every group), or a group id.
  const [groupFilter, setGroupFilter] = useState("all");
  const [subscriptionFilter, setSubscriptionFilter] = useState<AccessSubscriptionState | "all">(
    "all",
  );
  const subscriptionCounts = useMemo(() => countAccessSubscriptions(users), [users]);
  const accessGroupsQuery = useAccessGroups();
  const accessGroups = useMemo(() => accessGroupsQuery.data ?? [], [accessGroupsQuery.data]);
  const groupNames = useMemo(
    () => new Map(accessGroups.map((group) => [String(group.id), group.name])),
    [accessGroups],
  );
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sortField, setSortField] = useState<UserSortField>("username");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");

  const filteredUsers = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter((u) => {
      if (q && !(u.username?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))) {
        return false;
      }
      if (
        subscriptionFilter !== "all" &&
        accessSubscriptionOf(u.access_expires_at).state !== subscriptionFilter
      ) {
        return false;
      }
      if (groupFilter === "all") return true;
      // Admin accounts can't join groups, so they only appear under "All groups".
      if (u.role === "admin") return false;
      if (groupFilter === "none") return u.access_group_id == null;
      return String(u.access_group_id) === groupFilter;
    });
  }, [users, search, groupFilter, subscriptionFilter]);

  const sortedUsers = useMemo(
    () => sortAdminUsers(filteredUsers, sortField, sortDir),
    [filteredUsers, sortField, sortDir],
  );

  const total = sortedUsers.length;
  const paginatedUsers = sortedUsers.slice(page * pageSize, (page + 1) * pageSize);

  function handleSort(field: UserSortField) {
    setPage(0);
    if (field === sortField) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortField(field);
    setSortDir(field === "created_at" || field === "last_active_at" ? "desc" : "asc");
  }

  async function handleDelete(u: AdminUser) {
    if (busy.current || !available) return;
    busy.current = true;
    setActionError("");
    try {
      setConfirmDeleteUser(await getAdminUser(u.id, authority));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Benutzer konnte nicht geladen werden.");
    } finally {
      busy.current = false;
    }
  }

  function setActiveTab(value: string) {
    const nextTab = normalizeAdminUsersTab(value);
    const next = new URLSearchParams(searchParams);

    // The default tab stays the bare /admin/users URL.
    if (nextTab === "users") {
      next.delete("tab");
    } else {
      next.set("tab", nextTab);
    }

    setSearchParams(next, { replace: true });
  }

  if (isLoading)
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-lg" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );

  return (
    <div className="space-y-6">
      {confirmDeleteUser && (
        <AdminUserDeleteDialog
          initialEditor={confirmDeleteUser}
          onClose={() => setConfirmDeleteUser(null)}
          onDeleted={() => setConfirmDeleteUser(null)}
        />
      )}
      {impersonatingUser && (
        <AdminUserImpersonationDialog
          user={impersonatingUser}
          returnPath="/admin/users"
          onClose={() => setImpersonatingUser(null)}
          onError={setActionError}
        />
      )}
      <PageHeader
        title="Benutzer"
        subtitle="Zugriff, Standardwerte und Einladungen für alle verwalten, die Silo nutzen."
        actions={
          <>
            {serverSettings !== undefined && (
              <Link
                to="/admin/settings/sign-in"
                className="inline-flex w-fit items-center gap-1 hover:opacity-80"
              >
                <Badge
                  variant={signupsEnabled ? "outline" : "secondary"}
                  className={
                    signupsEnabled
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                      : undefined
                  }
                >
                  {signupsEnabled
                    ? "Öffentliche Registrierung an"
                    : "Öffentliche Registrierung aus"}
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Badge>
              </Link>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/access-groups">
                <Settings2 className="mr-1 h-4 w-4" /> Zugriffsgruppen
              </Link>
            </Button>
            <Dialog
              open={dialogOpen}
              onOpenChange={(open) => {
                if (formBusy.current || (open && !available)) return;
                setDialogOpen(open);
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-1 h-4 w-4" /> Benutzer hinzufügen
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Benutzer anlegen</DialogTitle>
                </DialogHeader>
                <CreateUserForm
                  onBusy={(value) => {
                    formBusy.current = value;
                  }}
                  onClose={() => setDialogOpen(false)}
                />
              </DialogContent>
            </Dialog>
          </>
        }
      />
      {actionError && <p role="alert">{actionError}</p>}
      {usersQuery.isError && (
        <div role="alert">
          Benutzer konnten nicht geladen werden.{" "}
          <Button onClick={() => void usersQuery.refetch()}>Benutzer neu laden</Button>
        </div>
      )}
      {!available && <p role="status">Die Benutzerverwaltung ist nicht verfügbar.</p>}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line" className="border-border w-full justify-start border-b">
          <TabsTrigger value="users">Benutzer</TabsTrigger>
          <TabsTrigger value="invitations">Einladungen</TabsTrigger>
          <TabsTrigger value="invite-codes">Einladungscodes</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="pt-4">
          <div
            className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4"
            role="group"
            aria-label="Abo-Übersicht"
          >
            {ACCESS_SUBSCRIPTION_STATES.map((state) => {
              const selected = subscriptionFilter === state;
              return (
                <button
                  key={state}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setSubscriptionFilter(selected ? "all" : state);
                    setPage(0);
                  }}
                  className={cn(
                    "surface-panel-subtle hover:bg-surface-hover/40 rounded-2xl border px-4 py-3 text-left transition-colors",
                    selected ? "border-primary" : "border-transparent",
                  )}
                >
                  <div className="text-2xl leading-none font-bold tabular-nums">
                    {subscriptionCounts[state]}
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {ACCESS_SUBSCRIPTION_LABELS[state]}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {state === "soon"
                      ? `endet in ${ACCESS_EXPIRING_SOON_DAYS} Tagen oder früher`
                      : state === "expired"
                        ? "Zugang beendet"
                        : state === "active"
                          ? "mit Enddatum"
                          : "ohne Enddatum, unbefristet"}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Nach Benutzername oder E-Mail suchen …"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                className="pr-9 pl-9"
              />
              {search && (
                <button
                  type="button"
                  aria-label="Suche löschen"
                  onClick={() => {
                    setSearch("");
                    setPage(0);
                  }}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Select
              value={groupFilter}
              onValueChange={(value) => {
                setGroupFilter(value);
                setPage(0);
              }}
            >
              <SelectTrigger className="sm:w-56" aria-label="Nach Zugriffsgruppe filtern">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Gruppen</SelectItem>
                {accessGroups.map((group) => (
                  <SelectItem key={group.id} value={String(group.id)}>
                    {group.name}
                  </SelectItem>
                ))}
                <SelectItem value="none">Keine Gruppe</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {accessGroupsQuery.isError && (
            <div role="alert" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
              Zugriffsgruppen konnten nicht geladen werden, Gruppennamen und Gruppenfilter sind
              daher nicht verfügbar.
              <Button variant="outline" size="sm" onClick={() => void accessGroupsQuery.refetch()}>
                Erneut versuchen
              </Button>
            </div>
          )}
          <div className="surface-panel overflow-x-auto rounded-2xl border-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableUserHead
                    field="username"
                    activeField={sortField}
                    activeDir={sortDir}
                    onSort={handleSort}
                  >
                    Benutzername
                  </SortableUserHead>
                  <SortableUserHead
                    field="email"
                    activeField={sortField}
                    activeDir={sortDir}
                    onSort={handleSort}
                  >
                    E-Mail
                  </SortableUserHead>
                  <SortableUserHead
                    field="role"
                    activeField={sortField}
                    activeDir={sortDir}
                    onSort={handleSort}
                  >
                    Rolle
                  </SortableUserHead>
                  <TableHead>Gruppe</TableHead>
                  <SortableUserHead
                    field="enabled"
                    activeField={sortField}
                    activeDir={sortDir}
                    onSort={handleSort}
                  >
                    Status
                  </SortableUserHead>
                  <SortableUserHead
                    field="access_expires_at"
                    activeField={sortField}
                    activeDir={sortDir}
                    onSort={handleSort}
                  >
                    Abo
                  </SortableUserHead>
                  <SortableUserHead
                    field="created_at"
                    activeField={sortField}
                    activeDir={sortDir}
                    onSort={handleSort}
                  >
                    Erstellt
                  </SortableUserHead>
                  <SortableUserHead
                    field="last_active_at"
                    activeField={sortField}
                    activeDir={sortDir}
                    onSort={handleSort}
                  >
                    Zuletzt aktiv
                  </SortableUserHead>
                  <TableHead className="w-32">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>
                      <Link to={`/admin/users/${u.id}`} className="font-medium hover:underline">
                        {u.username}
                      </Link>
                    </TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                        {accountRoleLabel(u)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {u.role === "admin" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : u.access_group_id == null ? (
                        <span className="text-muted-foreground">Keine Gruppe</span>
                      ) : (
                        <Link
                          to={`/admin/access-groups/${u.access_group_id}`}
                          className="hover:underline"
                        >
                          {groupNames.get(String(u.access_group_id)) ?? "Unbekannte Gruppe"}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.enabled ? "outline" : "destructive"}>
                        {u.enabled ? "Aktiv" : "Deaktiviert"}
                      </Badge>
                    </TableCell>
                    <AccessSubscriptionCell accessExpiresAt={u.access_expires_at} />
                    <TableCell title={formatFullDateTime(u.created_at)}>
                      {formatDateTime(u.created_at)}
                    </TableCell>
                    <TableCell title={u.last_active_at ? formatFullDateTime(u.last_active_at) : ""}>
                      {formatRelativeTime(u.last_active_at, "Nie")}
                    </TableCell>
                    <TableCell>
                      <TooltipProvider delayDuration={0}>
                        <div className="flex gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button asChild variant="ghost" size="icon" className="h-7 w-7">
                                <Link
                                  to={`/admin/history?user_id=${u.id}`}
                                  aria-label={`Wiedergabeverlauf von ${u.username} anzeigen`}
                                >
                                  <History className="h-3 w-3" aria-hidden="true" />
                                </Link>
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Wiedergabeverlauf anzeigen</TooltipContent>
                          </Tooltip>
                          {available && canViewAsAccount(u, viewerId, viewerIsOwner) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  aria-label={`Als Benutzer ansehen: ${u.username}`}
                                  onClick={() => setImpersonatingUser(u)}
                                >
                                  <UserRound className="h-3 w-3" aria-hidden="true" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Als Benutzer ansehen</TooltipContent>
                            </Tooltip>
                          )}
                          {canManageAccount(u, viewerId, viewerIsOwner) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button asChild variant="ghost" size="icon" className="h-7 w-7">
                                  <Link
                                    to={`/admin/users/${u.id}${userDetailTabSearch("access")}`}
                                    aria-label={`${u.username} bearbeiten`}
                                  >
                                    <Pencil className="h-3 w-3" aria-hidden="true" />
                                  </Link>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Benutzer bearbeiten</TooltipContent>
                            </Tooltip>
                          )}
                          {!u.is_owner &&
                            u.id !== viewerId &&
                            canManageAccount(u, viewerId, viewerIsOwner) && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    aria-label={`${u.username} löschen`}
                                    onClick={() => void handleDelete(u)}
                                  >
                                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Benutzer löschen</TooltipContent>
                              </Tooltip>
                            )}
                        </div>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {total > pageSize && (
              <div className="flex items-center justify-between px-4 py-4">
                <div className="flex items-center gap-4">
                  <span className="text-muted-foreground text-sm">
                    {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} von {total}
                  </span>
                  <Select
                    value={String(pageSize)}
                    onValueChange={(v) => {
                      setPageSize(Number(v));
                      setPage(0);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[100px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <SelectItem key={size} value={size}>
                          {size} Zeilen
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p - 1)}
                    disabled={page === 0}
                  >
                    Zurück
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={(page + 1) * pageSize >= total}
                  >
                    Weiter
                  </Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="invitations" className="pt-4">
          <InvitationsTab />
        </TabsContent>
        <TabsContent value="invite-codes" className="pt-4">
          <InviteCodesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AccessSubscriptionCell({ accessExpiresAt }: { accessExpiresAt?: string | null }) {
  const subscription = accessSubscriptionOf(accessExpiresAt);
  return (
    <TableCell>
      <div className="flex flex-col items-start gap-0.5">
        <AccessSubscriptionBadge state={subscription.state} />
        <span className="text-muted-foreground text-xs">
          {subscription.expiresAt
            ? `bis ${subscription.expiresAt.toLocaleDateString()} · ${accessSubscriptionRemainingLabel(subscription)}`
            : accessSubscriptionRemainingLabel(subscription)}
        </span>
      </div>
    </TableCell>
  );
}

function SortableUserHead({
  field,
  activeField,
  activeDir,
  onSort,
  children,
}: {
  field: UserSortField;
  activeField: UserSortField;
  activeDir: SortDirection;
  onSort: (field: UserSortField) => void;
  children: ReactNode;
}) {
  const active = field === activeField;

  return (
    <TableHead aria-sort={active ? (activeDir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
        onClick={() => onSort(field)}
      >
        {children}
        {active ? (
          activeDir === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <ChevronDown className="h-3 w-3 opacity-0" />
        )}
      </button>
    </TableHead>
  );
}

function sortAdminUsers(users: AdminUser[], field: UserSortField, dir: SortDirection) {
  const direction = dir === "asc" ? 1 : -1;

  return [...users].sort((a, b) => {
    let result = 0;
    switch (field) {
      case "username":
        result = compareText(a.username, b.username);
        break;
      case "email":
        result = compareText(a.email, b.email);
        break;
      case "role":
        result = compareText(accountRoleLabel(a), accountRoleLabel(b));
        break;
      case "enabled":
        result = compareText(a.enabled ? "active" : "disabled", b.enabled ? "active" : "disabled");
        break;
      case "access_expires_at":
        result = compareTime(a.access_expires_at, b.access_expires_at, dir);
        break;
      case "created_at":
        result = compareTime(a.created_at, b.created_at, dir);
        break;
      case "last_active_at":
        result = compareTime(a.last_active_at, b.last_active_at, dir);
        break;
    }

    if (result !== 0) {
      return field === "created_at" || field === "last_active_at" || field === "access_expires_at"
        ? result
        : result * direction;
    }

    return compareText(a.username, b.username) || a.id - b.id;
  });
}

function compareText(a?: string | null, b?: string | null) {
  return (a ?? "").localeCompare(b ?? "", undefined, { numeric: true, sensitivity: "base" });
}

function compareTime(a?: string | null, b?: string | null, dir: SortDirection = "asc") {
  const aTime = parseTime(a);
  const bTime = parseTime(b);
  if (aTime === null && bTime === null) return 0;
  if (aTime === null) return 1;
  if (bTime === null) return -1;
  return (aTime - bTime) * (dir === "asc" ? 1 : -1);
}

function parseTime(value?: string | null) {
  const timestamp = Date.parse(value ?? "");
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatDateTime(value?: string | null, fallback = "-") {
  const timestamp = parseTime(value);
  if (timestamp === null) return fallback;
  return formatDateTimePreferred(timestamp, { dateStyle: "medium", seconds: false });
}

function formatFullDateTime(value?: string | null) {
  const timestamp = parseTime(value);
  if (timestamp === null) return "";
  return formatDateTimePreferred(timestamp);
}

function formatRelativeTime(value?: string | null, fallback = "-") {
  const timestamp = parseTime(value);
  if (timestamp === null) return fallback;

  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "always" });

  for (const [unit, secondsPerUnit] of ranges) {
    if (Math.abs(seconds) >= secondsPerUnit || unit === "second") {
      return formatter.format(Math.round(seconds / secondsPerUnit), unit);
    }
  }

  return fallback;
}

function CreateUserForm({
  onClose,
  onBusy,
}: {
  onClose: () => void;
  onBusy: (busy: boolean) => void;
}) {
  const [authority] = useState(captureAdminUserAuthority);
  const busy = useRef(false);
  const [error, setError] = useState("");
  const capabilities = useAdminUserCapabilities();
  // Only the server Owner may grant the admin role; the server refuses anyone else.
  const viewerId = useAuth().user?.id;
  const viewerIsOwner = useViewerIsOwner(viewerId);
  const adminRoleLocked = !viewerIsOwner;
  const [createDefaultProfile, setCreateDefaultProfile] = useState(true);

  const { data: libraries = [] } = useAdminLibraries();
  const { data: accessGroups = [], isSuccess: accessGroupsLoaded } = useAccessGroups();
  const { data: policyDefaults } = useAdminPolicyDefaults();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [requirePasswordChange, setRequirePasswordChange] = useState(false);
  const [role, setRole] = useState("user");
  const [accessUntil, setAccessUntil] = useState("");
  const [permissions, setPermissions] = useState<string[]>([PERMISSION_MARKER_EDIT]);
  // Policy fields inherit from the access group unless explicitly overridden.
  const [policy, setPolicy] = useState(() => policyStateFromUser(null));
  const [invalidLimitDrafts, setInvalidLimitDrafts] = useState<ReadonlyMap<LimitPolicyKey, string>>(
    new Map(),
  );
  const [dialogTab, setDialogTab] = useState("account");
  const formRef = useRef<HTMLFormElement>(null);
  function handleInvalidLimitDraftChange(key: LimitPolicyKey, draft: string | undefined) {
    setInvalidLimitDrafts((current) => {
      if (current.get(key) === draft) return current;
      const next = new Map(current);
      if (draft === undefined) next.delete(key);
      else next.set(key, draft);
      return next;
    });
  }
  const usernameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const requireChangeId = useId();
  const roleId = useId();
  const accessUntilId = useId();
  const markerEditId = useId();
  const metadataCurationId = useId();
  const accessGroupSelectId = useId();
  const createMutation = useCreateUser();
  // The group picker starts on the default group (undefined until picked),
  // which is where the server would place the account anyway. An admin stays
  // ungrouped (auth.Repository create), so the picker is disabled for admins.
  const [pickedGroupID, setPickedGroupID] = useState<number | null | undefined>(undefined);
  const defaultGroupID = accessGroups.find((group) => group.is_default)?.id ?? null;
  const selectedGroupID = pickedGroupID === undefined ? defaultGroupID : pickedGroupID;
  const inheritGroupID = effectiveAccessGroupID(role, selectedGroupID);
  // Until the group list loads, the default group such an account joins is
  // unknown, and so is what it inherits; it is not the no-group defaults.
  const awaitingDefaultGroup =
    pickedGroupID === undefined && role !== "admin" && !accessGroupsLoaded;
  const hintSource = awaitingDefaultGroup ? "group" : policyDefaultSource(role, inheritGroupID);
  const inheritHints = awaitingDefaultGroup
    ? undefined
    : policyInheritHints(role, inheritGroupID, accessGroups, policyDefaults);
  // The group to send: none while the default group is still unknown, so the
  // server applies its own default instead of an accidental "no group".
  const groupToSend = awaitingDefaultGroup
    ? undefined
    : effectiveAccessGroupID(role, selectedGroupID);
  const accessGroupValue =
    awaitingDefaultGroup || role === "admin" || selectedGroupID === null
      ? "none"
      : String(selectedGroupID);
  // Creating an account can't choose "no group": the server treats a missing or
  // null group alike and places the account in the default group. Offer it only
  // when there is no default group to show instead.
  const offerNoGroup = awaitingDefaultGroup || defaultGroupID === null;
  const selectedGroupMissing =
    selectedGroupID !== null &&
    accessGroupsLoaded &&
    !accessGroups.some((group) => group.id === selectedGroupID);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (
      busy.current ||
      !capabilities.data?.available ||
      (createDefaultProfile && !capabilities.data.default_profile)
    )
      return;
    if (!isValidEmail(email)) {
      setError(INVALID_EMAIL_MESSAGE);
      return;
    }
    const passwordProblem = newPasswordProblem(password, password);
    if (passwordProblem) {
      setError(passwordProblem);
      return;
    }
    const expires = role === "admin" ? null : accessExpiryInstant(accessUntil);
    if (expires !== null && accessExpiryPassed(accessUntil)) {
      setError(ACCESS_EXPIRY_PASSED_MESSAGE);
      return;
    }
    // A cleared or half-typed limit is not in the policy state, which still
    // holds the last valid value; saving now would send that instead.
    if (invalidLimitDrafts.size > 0) {
      // The Limits fields mount only once the tab has rendered, so render it
      // now and then let the browser point at the invalid field.
      flushSync(() => setDialogTab("limits"));
      formRef.current?.reportValidity();
      return;
    }
    busy.current = true;
    onBusy(true);
    setError("");
    try {
      const body: CreateUserRequest = {
        username,
        email,
        password,
        ...(requirePasswordChange ? { require_password_change: true } : {}),
        role,
        permissions,
        create_default_profile: createDefaultProfile,
        ...policyCreateFields(policy),
        ...(typeof groupToSend === "number" ? { access_group_id: groupToSend } : {}),
        ...(expires !== null ? { access_expires_at: expires } : {}),
      };
      await createMutation.mutateAsync({ body, profileContext: authority });
      createMutation.reset();
      onClose();
    } catch (err) {
      setError(passwordErrorMessage(err, "Benutzer konnte nicht gespeichert werden."));
    } finally {
      busy.current = false;
      onBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex max-h-[70vh] flex-col">
      {error && <p role="alert">{error}</p>}
      <label className="mb-3 flex items-center gap-2">
        <input
          type="checkbox"
          checked={createDefaultProfile}
          onChange={(event) => setCreateDefaultProfile(event.target.checked)}
        />
        Standardprofil anlegen
        {!capabilities.data?.default_profile &&
          " (nicht verfügbar; abwählen, um nur das Konto anzulegen)"}
      </label>

      <Tabs value={dialogTab} onValueChange={setDialogTab} className="min-h-0 flex-1">
        <TabsList variant="line" className="border-border mb-4 w-full justify-start border-b pb-1">
          <TabsTrigger value="account" className="flex-none px-1">
            Konto
          </TabsTrigger>
          <TabsTrigger value="access" className="flex-none px-1">
            Zugriff
          </TabsTrigger>
          <TabsTrigger value="limits" className="flex-none px-1">
            Grenzen
          </TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <TabsContent value="account" className="mt-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={usernameId}>Benutzername</Label>
                <Input
                  id={usernameId}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={emailId}>E-Mail</Label>
                <Input
                  id={emailId}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={passwordId}>Passwort</Label>
                <Input
                  id={passwordId}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <div className="flex items-center gap-2">
                  <Switch
                    id={requireChangeId}
                    checked={requirePasswordChange && password !== ""}
                    disabled={password === ""}
                    onCheckedChange={setRequirePasswordChange}
                  />
                  <Label htmlFor={requireChangeId} className="text-xs font-normal">
                    Bei der ersten Anmeldung ändern lassen
                  </Label>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor={roleId}>Rolle</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger id={roleId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Benutzer</SelectItem>
                    <SelectItem value="admin" disabled={adminRoleLocked}>
                      Admin
                    </SelectItem>
                  </SelectContent>
                </Select>
                {adminRoleLocked && (
                  <p className="text-muted-foreground text-xs">
                    Nur der Server-Besitzer kann die Admin-Rolle vergeben.
                  </p>
                )}
              </div>
              {role !== "admin" && (
                <div className="space-y-2">
                  <Label htmlFor={accessUntilId}>Zugang bis</Label>
                  <Input
                    id={accessUntilId}
                    type="date"
                    value={accessUntil}
                    onChange={(e) => setAccessUntil(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    Optional. Nach diesem Tag wird das Konto automatisch deaktiviert.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="access" className="mt-0 space-y-4">
            <div className="space-y-2">
              <Label htmlFor={accessGroupSelectId}>Gruppe</Label>
              <Select
                value={accessGroupValue}
                onValueChange={(value) => {
                  setPickedGroupID(value === "none" ? null : Number(value));
                }}
                disabled={role === "admin" || awaitingDefaultGroup}
              >
                <SelectTrigger id={accessGroupSelectId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {offerNoGroup && (
                    <SelectItem value="none">
                      {awaitingDefaultGroup ? "Standardgruppe" : "Keine Gruppe"}
                    </SelectItem>
                  )}
                  {selectedGroupMissing && (
                    <SelectItem value={String(selectedGroupID)}>#{selectedGroupID}</SelectItem>
                  )}
                  {accessGroups.map((group) => (
                    <SelectItem key={group.id} value={String(group.id)}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {role === "admin" && (
                <p className="text-muted-foreground text-xs">
                  Admin-Konten können keiner Gruppe angehören.
                </p>
              )}
            </div>
            <div className="border-border flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor={markerEditId}>Marken bearbeiten</Label>
                <p className="text-muted-foreground text-xs">
                  Intro-, Rückblick-, Abspann- und Vorschau-Marken in den zugewiesenen Bibliotheken
                  bearbeiten.
                </p>
              </div>
              <Switch
                id={markerEditId}
                checked={hasAssignedPermission(permissions, PERMISSION_MARKER_EDIT)}
                onCheckedChange={(checked) =>
                  setPermissions((current) =>
                    setAssignedPermission(current, PERMISSION_MARKER_EDIT, checked),
                  )
                }
              />
            </div>
            <div className="border-border flex items-center justify-between rounded-md border px-3 py-2">
              <div>
                <Label htmlFor={metadataCurationId}>Metadaten pflegen</Label>
                <p className="text-muted-foreground text-xs">
                  Metadaten in den zugewiesenen Bibliotheken bearbeiten, aktualisieren und neu
                  zuordnen.
                </p>
              </div>
              <Switch
                id={metadataCurationId}
                checked={hasAssignedPermission(permissions, PERMISSION_METADATA_CURATION)}
                onCheckedChange={(checked) =>
                  setPermissions((current) =>
                    setAssignedPermission(current, PERMISSION_METADATA_CURATION, checked),
                  )
                }
              />
            </div>
            <PolicyAccessFields
              state={policy}
              onChange={setPolicy}
              source={hintSource}
              effective={inheritHints}
              libraries={libraries}
            />
          </TabsContent>

          <TabsContent value="limits" className="mt-0 space-y-4">
            <PolicyLimitFields
              state={policy}
              onChange={setPolicy}
              source={hintSource}
              effective={inheritHints}
              invalidLimitDrafts={invalidLimitDrafts}
              onInvalidLimitDraftChange={handleInvalidLimitDraftChange}
            />
          </TabsContent>
        </div>
      </Tabs>

      <div className="border-border mt-4 border-t pt-4">
        <Button
          type="submit"
          className="w-full"
          disabled={
            createMutation.isPending ||
            !capabilities.data?.available ||
            (createDefaultProfile && !capabilities.data.default_profile)
          }
        >
          {createMutation.isPending ? "Wird gespeichert …" : "Speichern"}
        </Button>
      </div>
    </form>
  );
}

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import type { FormEvent } from "react";
import {
  captureInvitationAuthority,
  invitationScope,
  type AdminInvitation as Invitation,
  type InvitationDelivery,
  type InvitationAuthority,
  type InvitationDeliveryChoice,
} from "@/api/v2/invitations";
type InvitationStatus = Invitation["status"];
import {
  useAdminInvitations,
  useInvitationCapabilities,
  useCreateInvitation,
  useResendInvitation,
  useRevokeInvitation,
} from "@/hooks/queries/admin/invitations";
import { useAccessGroups } from "@/hooks/queries/admin/accessGroups";
import { useViewerIsOwner } from "@/hooks/queries/admin/users";
import { useAdminLibraries } from "@/hooks/queries/admin/libraries";
import { useAdminServerSettings } from "@/hooks/queries/admin/settings";
import { effectiveAccessGroupID } from "@/components/UserPolicyFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LibraryAccessSelector } from "@/components/LibraryAccessSelector";
import { ChoiceOption } from "@/components/ChoiceOption";

import {
  AlertTriangle,
  ArrowRight,
  Copy,
  Link2,
  Mail,
  MailX,
  MailPlus,
  RotateCw,
  Trash2,
} from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { copyTextToClipboard } from "@/lib/clipboard";
import { INVALID_EMAIL_MESSAGE, isValidEmail } from "@/lib/email";
import { formatDate } from "@/lib/datetime";

// The claim-link box shown after create/resend. min-w-0 + overflow-hidden on
// every level matters: the URL is one unbreakable token, and without them it
// forces the dialog wider than the viewport on phones.
function ClaimLinkBox({
  claimUrl,
  finePrint,
  onCopy,
  onDone,
}: {
  claimUrl: string;
  finePrint: string;
  onCopy: (text: string) => Promise<void>;
  onDone: () => void;
}) {
  return (
    <div className="min-w-0 space-y-4">
      <div className="bg-muted min-w-0 overflow-hidden rounded-md p-2.5">
        <code className="block truncate text-xs">{claimUrl}</code>
      </div>
      <p className="text-muted-foreground text-xs">{finePrint}</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => onCopy(claimUrl)}>
          <Copy className="mr-1.5 h-4 w-4" /> Link kopieren
        </Button>
        <Button onClick={onDone}>Fertig</Button>
      </div>
    </div>
  );
}

const STATUS_BADGES: Record<InvitationStatus, { label: string; variant: "default" | "outline" }> = {
  pending: { label: "Offen", variant: "default" },
  accepted: { label: "Angenommen", variant: "outline" },
  expired: { label: "Abgelaufen", variant: "outline" },
  revoked: { label: "Widerrufen", variant: "outline" },
};

function deliveryMessage(result: InvitationDelivery) {
  // A replaced link for an emailed invitation stays bound to its address.
  if (result.delivery_status === "not_requested" && result.invitation.email)
    return `Neuer Link für ${result.invitation.email} erstellt. Es wurde keine E-Mail versendet; gib den Link selbst weiter.`;
  if (result.delivery_status === "not_requested")
    return "Einladungslink erstellt. Gib ihn an die eingeladene Person weiter. Sie gibt ihre E-Mail-Adresse ein und wählt ein Passwort.";
  if (result.delivery_status === "sent")
    return `E-Mail an ${result.invitation.email} gesendet. Die Zustellung ist nicht garantiert. Du kannst den Link unten kopieren.`;
  if (result.delivery_status === "not_configured")
    return "E-Mail ist nicht eingerichtet. Die Einladung wurde erstellt; gib den Link selbst weiter.";
  return "Die Einladung wurde erstellt, aber der E-Mail-Versand ist fehlgeschlagen oder unsicher. Der Link bleibt gültig; gib ihn selbst weiter.";
}
/** A pending link invitation has no address until someone accepts it. */
function isLinkInvitation(invitation: Invitation) {
  return invitation.email === "";
}

function DeliveryLabel({ delivery }: { delivery: Invitation["delivery"] }) {
  if (delivery === "link")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> Link erstellt
      </span>
    );
  if (delivery === "email_sent")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <Mail className="h-3.5 w-3.5" aria-hidden="true" /> E-Mail gesendet
      </span>
    );
  if (delivery === "email_unconfirmed")
    return (
      <span
        className="inline-flex items-center gap-1.5 text-sm text-amber-500"
        title="Die E-Mail ist fehlgeschlagen oder ihre Zustellung ist unsicher. Der Link funktioniert trotzdem."
      >
        <MailX className="h-3.5 w-3.5" aria-hidden="true" /> E-Mail nicht bestätigt
      </span>
    );
  return (
    <span
      className="text-muted-foreground text-sm"
      title="Erstellt, bevor die Zustellung erfasst wurde"
    >
      —
    </span>
  );
}

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
export default function InvitationsTab() {
  useAuth();
  return <InvitationManager key={invitationScope()} />;
}
function InvitationManager() {
  const viewerId = useAuth().user?.id;
  const viewerIsOwner = useViewerIsOwner(viewerId);
  const capabilities = useInvitationCapabilities();
  const available = capabilities.data?.state === "available";
  const history = useAdminInvitations(available);
  // Invitation links are built on the public URL, and the server refuses to
  // create one without it. Settings that are loading or unreadable block nothing.
  const serverSettings = useAdminServerSettings().data;
  const publicURLMissing =
    serverSettings !== undefined && (serverSettings["server.public_url"] ?? "").trim() === "";
  const invitations = history.data?.pages.flatMap((page) => page.items) ?? [];
  const resend = useResendInvitation();
  const revoke = useRevokeInvitation();
  const mounted = useMounted();
  const busy = useRef(false);
  const createBusy = useRef(false);
  const [createOpen, setCreateOpen] = useState(false);
  const emailDelivery = capabilities.data?.email_delivery === true;
  const [confirmRevoke, setConfirmRevoke] = useState<{
    row: Invitation;
    profileContext: InvitationAuthority;
  } | null>(null);
  const [revokeError, setRevokeError] = useState("");
  const [resendOpen, setResendOpen] = useState(false);
  const [resendResult, setResendResult] = useState<InvitationDelivery | null>(null);
  const [resendError, setResendError] = useState("");
  const [copyError, setCopyError] = useState("");
  async function handleCopy(text: string) {
    try {
      await copyTextToClipboard(text);
      if (mounted.current) {
        setCopyError("");
        toast.success("In die Zwischenablage kopiert");
      }
    } catch {
      if (mounted.current)
        setCopyError(
          "Der Link konnte nicht kopiert werden. Markiere und kopiere ihn von Hand oder versuche es erneut.",
        );
    }
  }
  async function handleResend(id: string, delivery: InvitationDeliveryChoice) {
    if (busy.current) return;
    busy.current = true;
    setResendOpen(true);
    setResendError("");
    setResendResult(null);
    setCopyError("");
    try {
      const result = await resend.mutateAsync({
        id,
        delivery,
        profileContext: captureInvitationAuthority(),
      });
      if (mounted.current) setResendResult(result);
    } catch (error) {
      if (mounted.current)
        setResendError(
          error instanceof Error
            ? error.message
            : "Einladung konnte nicht erneut gesendet werden. Lade den Verlauf neu, bevor du weitermachst.",
        );
    } finally {
      resend.reset();
      busy.current = false;
    }
  }
  async function handleRevoke() {
    if (busy.current || !confirmRevoke) return;
    busy.current = true;
    setRevokeError("");
    try {
      await revoke.mutateAsync({
        id: confirmRevoke.row.id,
        profileContext: confirmRevoke.profileContext,
      });
      if (mounted.current) setConfirmRevoke(null);
    } catch (error) {
      if (mounted.current)
        setRevokeError(
          error instanceof Error ? error.message : "Einladung konnte nicht widerrufen werden.",
        );
    } finally {
      revoke.reset();
      busy.current = false;
    }
  }
  if (capabilities.isPending) return <p>Einladungsfunktionen werden geladen …</p>;
  if (capabilities.isError)
    return (
      <div role="alert">
        Einladungsfunktionen konnten nicht geladen werden.{" "}
        <Button onClick={() => void capabilities.refetch()}>Neu laden</Button>
      </div>
    );
  if (!available) return <p>Einladungen sind auf diesem Server nicht eingerichtet.</p>;
  return (
    <div className="space-y-6">
      <Dialog
        open={confirmRevoke !== null}
        onOpenChange={(open) => {
          if (!open && !busy.current) setConfirmRevoke(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Einladung widerrufen</DialogTitle>
            <DialogDescription>
              {confirmRevoke && isLinkInvitation(confirmRevoke.row)
                ? "Diese Link-Einladung widerrufen? Der Link funktioniert dann nicht mehr."
                : `Die Einladung für ${confirmRevoke?.row.email} widerrufen? Der Link funktioniert dann nicht mehr.`}
            </DialogDescription>
          </DialogHeader>
          {revokeError && <p role="alert">{revokeError}</p>}
          <Button
            variant="outline"
            disabled={revoke.isPending}
            onClick={() => {
              if (!busy.current) setConfirmRevoke(null);
            }}
          >
            Abbrechen
          </Button>
          <Button
            variant="destructive"
            disabled={revoke.isPending}
            onClick={() => void handleRevoke()}
          >
            Widerrufen
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={resendOpen}
        onOpenChange={(open) => {
          if (!open && !busy.current) {
            setResendOpen(false);
            setResendResult(null);
            setCopyError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neuer Einladungslink</DialogTitle>
            <DialogDescription>
              {resendResult
                ? deliveryMessage(resendResult)
                : "Ein neuer Link macht den vorherigen ungültig."}
            </DialogDescription>
          </DialogHeader>
          {resend.isPending && <p>Neue Einladung wird erstellt …</p>}
          {resendError && (
            <div role="alert">
              <p>{resendError}</p>
              <p>
                Das Ergebnis ist möglicherweise unklar. Lade den Verlauf neu, bevor du erneut
                sendest.
              </p>
              <Button
                onClick={async () => {
                  try {
                    await history.restart();
                  } catch {
                    return;
                  }
                  if (mounted.current) {
                    setResendOpen(false);
                    setResendError("");
                  }
                }}
              >
                Verlauf neu laden
              </Button>
            </div>
          )}
          {copyError && <p role="alert">{copyError}</p>}
          {resendResult && (
            <ClaimLinkBox
              claimUrl={resendResult.claim_url}
              finePrint="Der Link funktioniert einmal. Ein vorheriger Link ist nicht mehr gültig."
              onCopy={handleCopy}
              onDone={() => {
                setResendOpen(false);
                setResendResult(null);
                setCopyError("");
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <div className="flex items-start justify-between gap-4">
        <p className="text-muted-foreground max-w-xl text-sm">
          Lade jemanden per E-Mail ein oder erstelle einen Link, den du selbst weitergibst. Die
          E-Mail-Adresse wird zum Benutzernamen.
        </p>
        <Dialog
          open={createOpen}
          onOpenChange={(open) => {
            if (!createBusy.current) {
              setCreateOpen(open);
              setCopyError("");
            }
          }}
        >
          <DialogTrigger asChild>
            <Button size="sm" disabled={publicURLMissing}>
              <MailPlus className="mr-1 h-4 w-4" />
              Jemanden einladen
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Jemanden einladen</DialogTitle>
              <DialogDescription>
                Wähle den Zugriff und wie die Person den Einladungslink bekommt.
              </DialogDescription>
            </DialogHeader>
            {copyError && <p role="alert">{copyError}</p>}
            <CreateInvitationForm
              defaultProfile={capabilities.data?.default_profile === true}
              emailDelivery={emailDelivery}
              onBusy={(value) => {
                createBusy.current = value;
              }}
              onReload={() => history.restart()}
              onClose={() => {
                if (!createBusy.current) {
                  setCreateOpen(false);
                  setCopyError("");
                }
              }}
              onCopy={handleCopy}
            />
          </DialogContent>
        </Dialog>
      </div>
      {publicURLMissing && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <p className="text-[13px] leading-relaxed">
            Lege die öffentliche Silo-Adresse fest, um Einladungslinks zu erstellen.{" "}
            <Link
              to="/admin/settings/general"
              className="text-foreground inline-flex items-center gap-1 font-medium hover:underline"
            >
              Allgemeine Einstellungen
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </p>
        </div>
      )}
      {resendError && !resendOpen && (
        <div role="alert">
          <p>{resendError}</p>
          <Button
            onClick={async () => {
              try {
                await history.restart();
                if (mounted.current) setResendError("");
              } catch {
                /* The history query displays the failure. */
              }
            }}
          >
            Verlauf neu laden
          </Button>
        </div>
      )}
      {history.isError && (
        <div role="alert">
          <p>Einladungsverlauf konnte nicht geladen werden. {history.error.message}</p>
          <Button onClick={() => void history.restart().catch(() => {})}>Verlauf neu laden</Button>
        </div>
      )}
      {history.isPending ? (
        <p>Einladungen werden geladen …</p>
      ) : invitations.length === 0 && !history.isError ? (
        <p>Noch keine Einladungen. Lade jemanden ein, um loszulegen.</p>
      ) : (
        invitations.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empfänger</TableHead>
                <TableHead>Rolle</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Zustellung</TableHead>
                <TableHead>Erstellt</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((inv) => (
                <InvitationRow
                  key={inv.id}
                  invitation={inv}
                  onResend={(delivery) => void handleResend(inv.id, delivery)}
                  emailDelivery={emailDelivery}
                  // Resending re-grants the role, so only the Owner resends an admin invitation.
                  resendAllowed={inv.role !== "admin" || viewerIsOwner}
                  onRevoke={() => {
                    if (busy.current) return;
                    setRevokeError("");
                    setConfirmRevoke({ row: inv, profileContext: captureInvitationAuthority() });
                  }}
                  resending={resend.isPending || revoke.isPending || !!resendError}
                  // A fresh link needs the public URL; revoking one does not.
                  resendBlocked={publicURLMissing}
                />
              ))}
            </TableBody>
          </Table>
        )
      )}
      {history.hasNextPage && (
        <Button
          variant="outline"
          disabled={history.isFetchingNextPage || history.isError}
          onClick={() => void history.fetchNextPage()}
        >
          Mehr laden
        </Button>
      )}
    </div>
  );
}

function InvitationRow({
  invitation,
  onResend,
  emailDelivery,
  onRevoke,
  resending,
  resendBlocked,
  resendAllowed,
}: {
  invitation: Invitation;
  onResend: (delivery: InvitationDeliveryChoice) => void;
  emailDelivery: boolean;
  onRevoke: () => void;
  resending: boolean;
  resendBlocked: boolean;
  resendAllowed: boolean;
}) {
  const badge = STATUS_BADGES[invitation.status];
  const showResend =
    resendAllowed && (invitation.status === "pending" || invitation.status === "expired");
  const showRevoke = invitation.status === "pending";
  const link = isLinkInvitation(invitation);
  // A link invitation's note is how the admin told it apart, so it stays
  // after acceptance fills in the address.
  const shared = invitation.delivery === "link";
  const details = [
    !link && invitation.status === "accepted" && shared ? "Über Link beigetreten" : "",
    shared && invitation.note ? `“${invitation.note}”` : "",
    invitation.invited_by_name ? `Eingeladen von ${invitation.invited_by_name}` : "",
  ].filter(Boolean);

  return (
    <TableRow>
      <TableCell className="max-w-xs">
        <div className="truncate font-medium">{link ? "Link-Einladung" : invitation.email}</div>
        {details.length > 0 && (
          <div className="text-muted-foreground truncate text-xs">{details.join(" · ")}</div>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {invitation.role === "admin" ? "Admin" : "Benutzer"}
      </TableCell>
      <TableCell>
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {invitation.status === "pending" && (
          <span className="text-muted-foreground ml-2 text-xs">
            läuft ab am {formatDate(invitation.expires_at)}
          </span>
        )}
      </TableCell>
      <TableCell>
        <DeliveryLabel delivery={invitation.delivery} />
      </TableCell>
      <TableCell className="text-muted-foreground text-sm">
        {formatDate(invitation.created_at)}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {showResend && (
            // Replacing the link never emails; an emailed invitation keeps its address.
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onResend("link")}
              disabled={resending || resendBlocked}
              title={link ? "Durch neuen Link ersetzen" : "Neuen Link kopieren, ohne E-Mail"}
            >
              {link ? <RotateCw className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
            </Button>
          )}
          {showResend && !link && emailDelivery && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onResend("email")}
              disabled={resending || resendBlocked}
              title="Neuen Link per E-Mail senden"
            >
              <MailPlus className="h-4 w-4" />
            </Button>
          )}
          {showRevoke && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRevoke}
              title="Diesen Link widerrufen"
              disabled={resending}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function CreateInvitationForm({
  onClose,
  onCopy,
  defaultProfile,
  emailDelivery,
  onBusy,
  onReload,
}: {
  defaultProfile: boolean;
  emailDelivery: boolean;
  onBusy: (value: boolean) => void;
  onReload: () => Promise<void>;
  onClose: () => void;
  onCopy: (text: string) => Promise<void>;
}) {
  const create = useCreateInvitation();
  const { data: accessGroups = [] } = useAccessGroups();
  const { data: libraries = [] } = useAdminLibraries();
  const [delivery, setDelivery] = useState<InvitationDeliveryChoice>(
    emailDelivery ? "email" : "link",
  );
  const deliveryGroup = useId();
  const [email, setEmail] = useState("");
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [role, setRole] = useState<"user" | "admin">("user");
  // Only the server Owner may invite an admin; the server refuses anyone else.
  const viewerId = useAuth().user?.id;
  const viewerIsOwner = useViewerIsOwner(viewerId);
  const [accessGroupID, setAccessGroupID] = useState<number | null>(null);
  const [libraryIDs, setLibraryIDs] = useState<number[] | null>(null);
  const [note, setNote] = useState("");
  const [createProfile, setCreateProfile] = useState(defaultProfile);
  const [showTour, setShowTour] = useState(true);
  // After creation we keep the dialog open to show the claim link — the
  // token is only readable in this response, so this is the one chance to
  // copy it. The delivery outcome describes what the sender confirmed.
  const [result, setResult] = useState<InvitationDelivery | null>(null);
  const [error, setError] = useState("");
  const [needsReload, setNeedsReload] = useState(false);
  const busy = useRef(false);
  const mounted = useMounted();
  const [profileContext] = useState(captureInvitationAuthority);
  const defaultGroup = useMemo(() => accessGroups.find((g) => g.is_default), [accessGroups]);
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy.current || needsReload || (!defaultProfile && createProfile)) return;
    if (delivery === "email" && !isValidEmail(email)) {
      setEmailInvalid(true);
      return;
    }
    busy.current = true;
    onBusy(true);
    setError("");
    const group = effectiveAccessGroupID(role, accessGroupID);
    try {
      const delivered = await create.mutateAsync({
        profileContext,
        body: {
          delivery,
          email: delivery === "email" ? email : undefined,
          role,
          access_group_id: group == null ? undefined : String(group),
          library_ids: libraryIDs == null ? undefined : libraryIDs.map(String),
          create_profile: createProfile,
          show_tour: showTour,
          note: note.trim() || undefined,
        },
      });
      if (mounted.current) setResult(delivered);
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : "Einladung konnte nicht erstellt werden.");
        setNeedsReload(true);
      }
    } finally {
      create.reset();
      busy.current = false;
      onBusy(false);
    }
  }

  if (result) {
    return (
      <div className="min-w-0 space-y-4">
        <p className="text-sm">{deliveryMessage(result)}</p>
        <ClaimLinkBox
          claimUrl={result.claim_url}
          finePrint={
            result.delivery_status === "not_requested"
              ? "Der Link funktioniert einmal und läuft nach 7 Tagen ab. Jeder mit dem Link kann ihn nutzen. Widerrufe ihn im Verlauf, falls er bei der falschen Person landet."
              : "Der Link funktioniert einmal und läuft nach 7 Tagen ab. Erneutes Senden erzeugt einen neuen Link und macht diesen ungültig."
          }
          onCopy={onCopy}
          onDone={onClose}
        />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div role="alert">
          <p>{error}</p>
          <p>
            Lade den Verlauf neu, bevor du es noch einmal versuchst; die Einladung existiert
            möglicherweise schon.
          </p>
          <Button
            type="button"
            onClick={async () => {
              try {
                await onReload();
              } catch {
                if (mounted.current)
                  setError(
                    "Einladungsverlauf konnte nicht neu geladen werden. Versuche es erneut, bevor du eine weitere Einladung erstellst.",
                  );
                return;
              }
              if (mounted.current) {
                setNeedsReload(false);
                setError("");
              }
            }}
          >
            Verlauf neu laden
          </Button>
        </div>
      )}
      {!defaultProfile && (
        <p role="status">
          Dieser Server kann ein Standardprofil nicht zuverlässig mitanlegen. Schalte die
          Profil-Option aus, um eine Einladung ohne Profil zu erstellen.
        </p>
      )}
      <div className="space-y-2">
        <p id={`${deliveryGroup}-label`} className="text-sm leading-none font-medium">
          Wie soll die Person die Einladung bekommen?
        </p>
        <div
          role="radiogroup"
          aria-labelledby={`${deliveryGroup}-label`}
          className="grid gap-2 sm:grid-cols-2"
        >
          <ChoiceOption
            name={deliveryGroup}
            value="link"
            selected={delivery === "link"}
            disabled={create.isPending}
            title="Link erstellen"
            onSelect={setDelivery}
          >
            Du gibst den Link selbst weiter, zum Beispiel in einem Chat.
          </ChoiceOption>
          <ChoiceOption
            name={deliveryGroup}
            value="email"
            selected={delivery === "email"}
            disabled={!emailDelivery || create.isPending}
            title="E-Mail senden"
            onSelect={setDelivery}
          >
            {emailDelivery
              ? "Wir senden den Link per E-Mail. Du kannst ihn auch kopieren."
              : "E-Mail ist auf diesem Server nicht eingerichtet."}
          </ChoiceOption>
        </div>
        {!emailDelivery && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            <p className="text-[13px] leading-relaxed">
              Um Einladungen per E-Mail zu senden, richte den Mailserver ein unter{" "}
              <Link
                to="/admin/settings/email"
                className="text-foreground inline-flex items-center gap-1 font-medium hover:underline"
              >
                E-Mail-Einstellungen
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </p>
          </div>
        )}
      </div>

      {delivery === "email" && (
        <div className="space-y-2">
          <Label htmlFor="invitation-email">E-Mail-Adresse</Label>
          <Input
            id="invitation-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (emailInvalid) setEmailInvalid(false);
            }}
            placeholder="name@beispiel.de"
            aria-invalid={emailInvalid || undefined}
            aria-describedby={emailInvalid ? "invitation-email-error" : undefined}
            autoFocus
            required
          />
          {emailInvalid ? (
            <p id="invitation-email-error" className="text-destructive text-xs">
              {INVALID_EMAIL_MESSAGE}
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            Das ist zugleich die Zieladresse und der Benutzername für die Anmeldung.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Zugriffsgruppe</Label>
          <Select
            value={role === "admin" || accessGroupID === null ? "default" : String(accessGroupID)}
            onValueChange={(v) => setAccessGroupID(v === "default" ? null : Number(v))}
            disabled={role === "admin"}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">
                {defaultGroup ? `${defaultGroup.name} (Standard)` : "Server-Standard"}
              </SelectItem>
              {accessGroups
                .filter((g) => !g.is_default)
                .map((g) => (
                  <SelectItem key={g.id} value={String(g.id)}>
                    {g.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Rolle</Label>
          <Select value={role} onValueChange={(value) => setRole(value as "user" | "admin")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">Benutzer</SelectItem>
              <SelectItem value="admin" disabled={!viewerIsOwner}>
                Admin
              </SelectItem>
            </SelectContent>
          </Select>
          {!viewerIsOwner && (
            <p className="text-muted-foreground text-xs">
              Nur der Server-Besitzer kann einen Admin einladen.
            </p>
          )}
        </div>
      </div>

      <LibraryAccessSelector
        libraries={libraries}
        value={libraryIDs}
        onChange={setLibraryIDs}
        allLabel="Von der Zugriffsgruppe übernehmen"
        emptyHint="Das bei der Annahme angelegte Konto erhält die Bibliotheken der gewählten Gruppe."
      />

      <div className="space-y-2">
        <Label htmlFor="invitation-note">
          {delivery === "link" ? "Notiz (optional)" : "Persönliche Nachricht (optional)"}
        </Label>
        <textarea
          id="invitation-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Hallo – richte dich ein, wann es dir passt."
          rows={2}
          className="border-border bg-background text-foreground focus:border-ring focus:ring-ring/50 w-full resize-y rounded-md border px-3 py-2.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus:ring-[3px]"
        />
        <p className="text-muted-foreground text-xs">
          {delivery === "link"
            ? "Wird auf der Einladungsseite und in deinem Einladungsverlauf angezeigt, damit du Links unterscheiden kannst."
            : "Erscheint in der E-Mail und auf der Einladungsseite. Nur Text."}
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="invitation-create-profile">Erstes Profil anlegen</Label>
            <p className="text-muted-foreground text-xs">
              {delivery === "link"
                ? "Benannt nach dem Teil vor dem @ der eingegebenen E-Mail. Der Name lässt sich später ändern."
                : "Benannt nach dem Teil vor dem @. Der Name lässt sich später ändern."}
            </p>
          </div>
          <Switch
            id="invitation-create-profile"
            checked={createProfile}
            onCheckedChange={setCreateProfile}
            disabled={!defaultProfile && !createProfile}
          />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="invitation-show-tour">
              Funktionstour bei der ersten Anmeldung zeigen
            </Label>
            <p className="text-muted-foreground text-xs">
              Zeigt, was dieser Server kann, und lässt ausgeschaltete Funktionen weg.
            </p>
          </div>
          <Switch id="invitation-show-tour" checked={showTour} onCheckedChange={setShowTour} />
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <p className="text-muted-foreground text-xs">
          Link läuft nach 7 Tagen ab · einmalig nutzbar
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" disabled={create.isPending} onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            type="submit"
            disabled={create.isPending || needsReload || (!defaultProfile && createProfile)}
          >
            {delivery === "link"
              ? create.isPending
                ? "Wird erstellt …"
                : "Link erstellen"
              : create.isPending
                ? "Wird gesendet …"
                : "Einladung senden"}
          </Button>
        </div>
      </div>
    </form>
  );
}

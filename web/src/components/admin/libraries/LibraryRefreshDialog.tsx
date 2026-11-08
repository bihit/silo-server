import { DatabaseBackup, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LibraryRefreshMode } from "@/hooks/queries/admin/libraries";

interface LibraryRefreshDialogProps {
  libraryName: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (mode: LibraryRefreshMode) => void;
  isPending?: boolean;
}

export function LibraryRefreshDialog({
  libraryName,
  onOpenChange,
  onConfirm,
  isPending = false,
}: LibraryRefreshDialogProps) {
  return (
    <Dialog open={libraryName !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Metadaten der Bibliothek aktualisieren</DialogTitle>
          <DialogDescription>
            Wähle, wie viel von {libraryName ?? "dieser Bibliothek"} bei den Metadaten-Anbietern
            aktualisiert werden soll.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <button
            type="button"
            disabled={isPending}
            onClick={() => onConfirm("quick")}
            className="border-border bg-surface hover:bg-surface/80 flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="text-muted-foreground mt-0.5 size-5 shrink-0 animate-spin" />
            ) : (
              <RefreshCw className="text-muted-foreground mt-0.5 size-5 shrink-0" />
            )}
            <div className="space-y-1">
              <div className="text-sm font-semibold">Fehlende Metadaten aktualisieren</div>
              <div className="text-muted-foreground text-sm">
                Aktualisiert zugeordnete Einträge, die noch nie aktualisiert wurden, denen eine
                Beschreibung oder Bilder fehlen oder deren letzte Aktualisierung fehlgeschlagen ist.
              </div>
            </div>
          </button>

          <button
            type="button"
            disabled={isPending}
            onClick={() => onConfirm("full")}
            className="border-border bg-surface hover:bg-surface/80 flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? (
              <Loader2 className="text-muted-foreground mt-0.5 size-5 shrink-0 animate-spin" />
            ) : (
              <DatabaseBackup className="text-muted-foreground mt-0.5 size-5 shrink-0" />
            )}
            <div className="space-y-1">
              <div className="text-sm font-semibold">Alle Metadaten aktualisieren</div>
              <div className="text-muted-foreground text-sm">
                Lädt jeden Eintrag neu von seinen Anbietern, einschließlich Titel, Bilder, Staffeln
                und Episoden. Große Bibliotheken können Stunden dauern. Gesperrte Felder und Bilder
                bleiben unverändert.
              </div>
            </div>
          </button>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Abbrechen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

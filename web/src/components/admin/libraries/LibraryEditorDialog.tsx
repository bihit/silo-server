import { useState } from "react";
import type { FormEvent } from "react";
import { Database, FolderOpen, Settings2, SlidersHorizontal } from "lucide-react";

import type { Library } from "@/api/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import {
  AdvancedFields,
  FolderFields,
  GeneralFields,
  MetadataFields,
  RealtimeMonitoringFields,
} from "./LibraryFormSections";
import { libraryTypeMeta } from "./libraryTypes";
import { LibraryPosterSection } from "./LibraryPosterSection";
import { useLibraryForm } from "./useLibraryForm";
import type { LibraryFormErrors } from "./useLibraryForm";

type SectionId = "general" | "folders" | "metadata" | "advanced";

const SECTIONS: Array<{
  id: SectionId;
  label: string;
  icon: typeof Settings2;
  title: string;
  description: string;
}> = [
  {
    id: "general",
    label: "Allgemein",
    icon: Settings2,
    title: "Allgemein",
    description: "Benenne die Bibliothek und wähle, welche Art von Medien sie enthält.",
  },
  {
    id: "folders",
    label: "Ordner",
    icon: FolderOpen,
    title: "Ordner",
    description: "Silo durchsucht diese Ordner nach Medien und überwacht sie auf Änderungen.",
  },
  {
    id: "metadata",
    label: "Metadaten",
    icon: Database,
    title: "Metadaten",
    description: "Lege fest, woher Bilder und Beschreibungen kommen und in welcher Sprache.",
  },
  {
    id: "advanced",
    label: "Erweitert",
    icon: SlidersHorizontal,
    title: "Erweitert",
    description: "Optionale Hintergrundverarbeitung für diese Bibliothek.",
  },
];

function sectionForErrors(errors: LibraryFormErrors): SectionId | null {
  if (errors.name) return "general";
  if (errors.paths) return "folders";
  return null;
}

export interface LibraryEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  library: Library | null;
  chapterThumbnailsSupported: boolean;
  /** Undefined when the server does not offer seek previews. */
  trickplaySupported?: boolean;
}

export function LibraryEditorDialog({
  open,
  onOpenChange,
  library,
  chapterThumbnailsSupported,
  trickplaySupported,
}: LibraryEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(40rem,calc(100dvh-4rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <LibraryEditorBody
          key={library?.id ?? "new"}
          library={library}
          chapterThumbnailsSupported={chapterThumbnailsSupported}
          trickplaySupported={trickplaySupported}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function LibraryEditorBody({
  library,
  chapterThumbnailsSupported,
  trickplaySupported,
  onClose,
}: {
  library: Library | null;
  chapterThumbnailsSupported: boolean;
  trickplaySupported?: boolean;
  onClose: () => void;
}) {
  const [section, setSection] = useState<SectionId>("general");
  const form = useLibraryForm({ library, onClose });

  const sections = SECTIONS.filter(
    ({ id }) =>
      id !== "advanced" ||
      form.settingSupport.chapterThumbnails ||
      form.settingSupport.introDetection,
  );
  const activeSection = sections.some(({ id }) => id === section) ? section : "general";

  const typeMeta = libraryTypeMeta(form.type);
  const folderCount = form.paths.filter((p) => p.trim()).length;
  const errorSections = new Set<SectionId>();
  if (form.errors.name) errorSections.add("general");
  if (form.errors.paths) errorSections.add("folders");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const result = form.submit();
    if (!result.ok) {
      const target = sectionForErrors(result.errors);
      if (target) setSection(target);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="border-border shrink-0 border-b px-5 py-4 pr-12 sm:px-6 sm:pr-12">
        <div className="flex items-center gap-3">
          <div className="border-border bg-surface text-primary flex size-10 shrink-0 items-center justify-center rounded-xl border">
            <typeMeta.icon className="size-5" />
          </div>
          <div className="min-w-0 space-y-0.5 text-left">
            <DialogTitle>{library ? "Bibliothek bearbeiten" : "Bibliothek hinzufügen"}</DialogTitle>
            <DialogDescription className="truncate text-xs">
              {library
                ? `Lege fest, wie „${library.name}“ gescannt und zugeordnet wird.`
                : "Richte eine neue Bibliothek aus Ordnern auf deinem Server ein."}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <Tabs
        value={activeSection}
        onValueChange={(value) => setSection(value as SectionId)}
        orientation="vertical"
        className="min-h-0 flex-1 gap-0"
      >
        <div className="border-border shrink-0 overflow-y-auto border-r">
          <TabsList className="w-13 flex-col items-stretch justify-start gap-1 rounded-none bg-transparent p-2 sm:w-44 sm:p-3">
            {sections.map(({ id, label, icon: Icon }) => (
              <TabsTrigger
                key={id}
                value={id}
                className="h-auto shrink-0 justify-start gap-2.5 rounded-lg px-2.5 py-2 sm:px-3"
              >
                <Icon className="size-4 shrink-0" />
                <span className="hidden sm:inline">{label}</span>
                {errorSections.has(id) ? (
                  <span
                    className={cn(
                      "bg-destructive size-1.5 rounded-full",
                      "absolute top-1 right-1 sm:static sm:ml-auto",
                    )}
                  />
                ) : id === "folders" && folderCount > 0 ? (
                  <span className="text-muted-foreground ml-auto hidden font-mono text-[10px] tabular-nums sm:inline">
                    {folderCount}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="overlay-scroll min-h-0 flex-1 overflow-y-auto">
          {sections.map(({ id, title, description }) => (
            <TabsContent
              key={id}
              value={id}
              className="animate-in fade-in-0 slide-in-from-right-1 px-5 py-5 duration-200 sm:px-6"
            >
              <div className="mb-5 space-y-1">
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="text-muted-foreground text-xs">{description}</p>
              </div>
              {id === "general" && (
                <GeneralFields
                  form={form}
                  posterSlot={library ? <LibraryPosterSection library={library} /> : null}
                />
              )}
              {id === "folders" && (
                <div className="space-y-5">
                  <FolderFields form={form} />
                  <RealtimeMonitoringFields form={form} />
                </div>
              )}
              {id === "metadata" && <MetadataFields form={form} />}
              {id === "advanced" && (
                <AdvancedFields
                  form={form}
                  chapterThumbnailsSupported={chapterThumbnailsSupported}
                  trickplaySupported={trickplaySupported}
                />
              )}
            </TabsContent>
          ))}
        </div>
      </Tabs>

      <div className="border-border flex shrink-0 items-center justify-end gap-2 border-t px-5 py-4 sm:px-6">
        {errorSections.size > 0 ? (
          <p className="text-destructive mr-auto text-xs">
            {[form.errors.name, form.errors.paths].filter(Boolean).join(" ")}
          </p>
        ) : null}
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Abbrechen
          </Button>
        </DialogClose>
        <Button type="submit" disabled={form.isPending}>
          {form.isPending
            ? library
              ? "Wird gespeichert …"
              : "Wird erstellt …"
            : library
              ? "Änderungen speichern"
              : "Bibliothek erstellen"}
        </Button>
      </div>
    </form>
  );
}

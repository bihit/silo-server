import { useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderSearch,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Link } from "react-router";

import FolderBrowser from "@/components/FolderBrowser";
import PathAutocompleteInput from "@/components/PathAutocompleteInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useLibraryRealtimeMonitoring } from "@/hooks/queries/admin/libraries";
import { cn } from "@/lib/utils";
import { extraKindGroupLabel, PROVIDER_TRAILER_KINDS } from "@/lib/extraKinds";
import { LANGUAGES } from "@/player/utils/languageNames";

import { BOX_SET_MIN_MOVIE_OPTIONS, LIBRARY_TYPES } from "./libraryTypes";
import {
  REALTIME_MONITORING_SETTINGS_PATH,
  realtimeMonitoringNeedsAttention,
  realtimeMonitoringStatusText,
} from "./realtimeMonitoring";
import { contentLevelLabel } from "./useLibraryForm";
import type { LevelChainItem, LibraryFormController } from "./useLibraryForm";
import { LibraryTranslatePanel } from "./LibraryTranslatePanel";

// A library's metadata_language is a bare ISO 639-1 code; the server rejects
// regional tags such as pt-BR, so the picker leaves them out.
const LIBRARY_METADATA_LANGUAGES = LANGUAGES.filter((lang) => /^[a-z]{2}$/.test(lang.code));

function SettingCard({
  htmlFor,
  title,
  description,
  children,
  footer,
}: {
  htmlFor?: string;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="border-border bg-surface rounded-xl border p-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor={htmlFor}>{title}</Label>
          <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
          {footer}
        </div>
        {children}
      </div>
    </div>
  );
}

export function GeneralFields({
  form,
  posterSlot,
}: {
  form: LibraryFormController;
  posterSlot?: ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="library-name">Name</Label>
        <Input
          id="library-name"
          value={form.name}
          onChange={(e) => form.setName(e.target.value)}
          placeholder="z. B. Filme"
          aria-invalid={form.errors.name ? true : undefined}
        />
        {form.errors.name ? <p className="text-destructive text-xs">{form.errors.name}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label>Typ</Label>
        <div
          className="grid grid-cols-3 gap-2 sm:grid-cols-5"
          role="radiogroup"
          aria-label="Bibliothekstyp"
        >
          {LIBRARY_TYPES.map(({ value, label, icon: Icon }) => {
            const selected = form.type === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => form.handleTypeChange(value)}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 transition-colors duration-150",
                  selected
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                )}
              >
                <Icon
                  className={cn("size-5", selected ? "text-primary" : "text-muted-foreground")}
                />
                <span className="text-[11px] font-medium">{label}</span>
              </button>
            );
          })}
        </div>
        {form.library && form.type !== form.library.type ? (
          <p className="text-warning text-xs">
            Wird der Typ einer bestehenden Bibliothek geändert, kann ein vollständiger neuer Scan
            nötig sein, damit die Einträge neu zugeordnet werden.
          </p>
        ) : null}
      </div>
      <SettingCard
        htmlFor="library-enabled-switch"
        title="Aktiv"
        description="Deaktivierte Bibliotheken sind beim Stöbern ausgeblendet und werden bei Scans übersprungen."
      >
        <Switch
          id="library-enabled-switch"
          checked={form.enabled}
          onCheckedChange={form.setEnabled}
        />
      </SettingCard>
      {posterSlot}
    </div>
  );
}

export function FolderFields({ form }: { form: LibraryFormController }) {
  const [browserOpen, setBrowserOpen] = useState(false);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {form.paths.map((path, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <FolderOpen className="text-muted-foreground/60 size-4 shrink-0" />
            <PathAutocompleteInput
              value={path}
              onValueChange={(value) => form.updatePath(i, value)}
              placeholder="/mnt/media/movies"
              aria-invalid={form.errors.paths ? true : undefined}
            />
            {form.paths.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive size-9 shrink-0"
                onClick={() => form.removePath(i)}
                title="Ordner entfernen"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
      {form.errors.paths ? <p className="text-destructive text-xs">{form.errors.paths}</p> : null}
      <div className="flex gap-1.5">
        <Button type="button" variant="outline" size="sm" onClick={() => setBrowserOpen(true)}>
          <FolderSearch className="mr-1 size-3.5" /> Durchsuchen
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={form.addPath}>
          <Plus className="mr-1 size-3.5" /> Pfad hinzufügen
        </Button>
      </div>
      <FolderBrowser
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        onSelect={(selected) => {
          form.mergeBrowsedPaths(selected);
          setBrowserOpen(false);
        }}
        existingPaths={form.paths.filter((path) => path.trim())}
      />
    </div>
  );
}

/**
 * The library's real-time monitoring switch and the server's status line for
 * it. It stays out of FolderFields, which the setup wizard also renders, so
 * only the admin library editor fetches the monitoring status.
 */
export function RealtimeMonitoringFields({ form }: { form: LibraryFormController }) {
  const { data: status } = useLibraryRealtimeMonitoring();
  const serverOff = status?.server_enabled === false;
  const { library } = form;
  const entry = library
    ? status?.libraries.find((candidate) => candidate.library_id === library.id)
    : undefined;
  // The status describes the saved switch, so an unsaved change hides it
  // rather than contradicting it.
  const hasUnsavedChange = form.realtimeMonitoring !== (library?.realtime_monitoring ?? true);

  let footer: ReactNode = null;
  if (serverOff) {
    footer = (
      <p className="text-muted-foreground text-xs">
        Die Echtzeit-Überwachung ist serverweit ausgeschaltet. Einschalten unter{" "}
        <Link
          to={REALTIME_MONITORING_SETTINGS_PATH}
          className="text-foreground font-medium underline underline-offset-2"
        >
          Einstellungen → Library &amp; Metadata
        </Link>
        .
      </p>
    );
  } else if (entry && !hasUnsavedChange) {
    footer = (
      <p
        className={cn(
          "text-xs",
          realtimeMonitoringNeedsAttention(entry) ? "text-warning" : "text-muted-foreground",
        )}
      >
        Status: {realtimeMonitoringStatusText(entry)}
      </p>
    );
  }

  return (
    <SettingCard
      htmlFor="realtime-monitoring-switch"
      title="Echtzeit-Überwachung"
      description="Diese Bibliothek automatisch scannen, wenn sich ihre Dateien ändern."
      footer={footer}
    >
      <Switch
        id="realtime-monitoring-switch"
        checked={form.realtimeMonitoring}
        disabled={serverOff}
        onCheckedChange={form.setRealtimeMonitoring}
      />
    </SettingCard>
  );
}

function ProviderLevelSection({
  level,
  items,
  onReorder,
  onToggleEnabled,
}: {
  level: string;
  items: LevelChainItem[];
  onReorder: (items: LevelChainItem[]) => void;
  onToggleEnabled: (index: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  const moveItem = (index: number, direction: -1 | 1) => {
    const newItems = [...items];
    const target = index + direction;
    if (target < 0 || target >= newItems.length) return;
    [newItems[index], newItems[target]] = [newItems[target]!, newItems[index]!];
    onReorder(newItems);
  };

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="text-primary hover:text-primary/80 mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase"
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {contentLevelLabel(level)}
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-1">
          {items.map((item, i) => (
            <div
              key={`${item.plugin_installation_id}:${item.capability_id}`}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm",
                item.enabled
                  ? "border-border bg-muted text-foreground"
                  : "border-border/50 bg-muted/30 text-muted-foreground",
              )}
            >
              <input
                type="checkbox"
                checked={item.enabled}
                onChange={() => onToggleEnabled(i)}
                className="h-3.5 w-3.5"
                style={{ accentColor: "var(--primary)" }}
              />
              <span className="flex-1 font-mono text-xs">{item.provider_slug}</span>
              <div className="flex gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  disabled={i === 0}
                  onClick={() => moveItem(i, -1)}
                >
                  <ArrowUp className="h-2.5 w-2.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  disabled={i === items.length - 1}
                  onClick={() => moveItem(i, 1)}
                >
                  <ArrowDown className="h-2.5 w-2.5" />
                </Button>
              </div>
              <span className="text-muted-foreground/70 font-mono text-[10px]">{i + 1}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// The offered sizes, plus a saved size outside them so it stays selected.
function boxSetMinMovieOptions(current: number): number[] {
  return [...new Set<number>([...BOX_SET_MIN_MOVIE_OPTIONS, current])].sort((a, b) => a - b);
}

export function BoxSetFields({ form }: { form: LibraryFormController }) {
  return (
    <div className="border-border bg-surface rounded-xl border p-3.5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="box-sets-enabled">Box sets</Label>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Group movies that TMDB lists in the same collection, such as the Harry Potter films,
            into one box set in this library. Your files and watch history stay as they are.
          </p>
        </div>
        <Switch
          id="box-sets-enabled"
          checked={form.boxSetsEnabled}
          onCheckedChange={form.setBoxSetsEnabled}
        />
      </div>
      {form.boxSetsEnabled && (
        <div className="border-border mt-3 space-y-3 border-t pt-3">
          <div className="space-y-1.5">
            <Label id="box-set-min-movies-label">Minimum movies in a box set</Label>
            <div
              role="radiogroup"
              aria-labelledby="box-set-min-movies-label"
              className="border-border inline-flex gap-0.5 rounded-full border p-0.5"
            >
              {boxSetMinMovieOptions(form.boxSetMinMovies).map((count) => {
                const selected = form.boxSetMinMovies === count;
                return (
                  <button
                    key={count}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => form.setBoxSetMinMovies(count)}
                    className={cn(
                      "rounded-full px-3 py-0.5 text-xs font-medium transition-colors",
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {count}
                  </button>
                );
              })}
            </div>
            <p className="text-muted-foreground text-xs">
              A box set needs at least this many of its movies in this library. With fewer, the
              movies show on their own.
            </p>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="box-sets-in-search">Show box sets in search</Label>
              <p className="text-muted-foreground text-xs">
                List a matching box set first in search results, with its movies after it.
              </p>
            </div>
            <Switch
              id="box-sets-in-search"
              checked={form.boxSetsInSearch}
              onCheckedChange={form.setBoxSetsInSearch}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            Box sets appear once Silo has looked up your movies&apos; collections, which runs in the
            background after you save.
          </p>
        </div>
      )}
    </div>
  );
}

export function MetadataFields({ form }: { form: LibraryFormController }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label>Metadatensprache</Label>
        <Select value={form.metadataLanguage} onValueChange={form.setMetadataLanguage}>
          <SelectTrigger className="w-full sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIBRARY_METADATA_LANGUAGES.map((lang) => (
              <SelectItem key={lang.code} value={lang.code}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-xs">
          Bevorzugte Sprache für Titel, Zusammenfassungen und Bilder, die von Anbietern geladen
          werden.
        </p>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="auto-translate-metadata">Beschreibungen automatisch übersetzen</Label>
          <p className="text-muted-foreground text-xs">
            Haben die Anbieter keine Übersetzung in der Sprache dieser Bibliothek, werden
            Beschreibungen nach jeder Aktualisierung per KI übersetzt. Dafür muss die KI-Übersetzung
            von Beschreibungen unter Admin-Einstellungen → AI aktiv sein.
          </p>
        </div>
        <Switch
          id="auto-translate-metadata"
          checked={form.autoTranslateMetadata}
          onCheckedChange={form.setAutoTranslateMetadata}
        />
      </div>
      {form.library && <LibraryTranslatePanel libraryId={form.library.id} />}
      {form.settingSupport.boxSets && <BoxSetFields form={form} />}
      {form.settingSupport.trailers && (
        <div className="space-y-1.5">
          <Label>Trailer- und Extra-Typen</Label>
          <p className="text-muted-foreground text-xs">
            Videotypen, die bei der Aktualisierung von Metadaten-Anbietern geladen werden. Alles
            abwählen, um externe Trailer für diese Bibliothek abzuschalten.
          </p>
          <div
            className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
            role="group"
            aria-label="Trailer- und Extra-Typen"
          >
            {PROVIDER_TRAILER_KINDS.map((kind) => {
              const checked = form.trailerKinds.includes(kind);
              return (
                <label
                  key={kind}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm",
                    checked
                      ? "border-border bg-muted text-foreground"
                      : "border-border/50 bg-muted/30 text-muted-foreground",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => form.toggleTrailerKind(kind)}
                    className="h-3.5 w-3.5"
                    style={{ accentColor: "var(--primary)" }}
                  />
                  {extraKindGroupLabel(kind)}
                </label>
              );
            })}
          </div>
        </div>
      )}
      {form.contentLevels.length > 0 && (
        <div className="space-y-1.5">
          <Label>Anbieter-Reihenfolge</Label>
          <p className="text-muted-foreground mb-3 text-xs">
            Lokale Metadaten kommen immer zuerst. Externe Anbieter werden von oben nach unten
            abgefragt und ergänzen, was noch fehlt. Einen Anbieter abwählen, um ihn für diese Ebene
            zu überspringen.
          </p>
          {form.chainLoading ? (
            <div className="border-border bg-surface text-muted-foreground flex items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-xs">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Anbieter werden geladen …
            </div>
          ) : form.hasMetadataProviders ? (
            <>
              {form.hasLocalMetadata && (
                <div className="mb-3">
                  <SettingCard
                    htmlFor="local-metadata-switch"
                    title="Lokale Metadaten (NFO + Bilder)"
                    description="Liest .nfo-Dateien und Bilder, die neben deinen Medien liegen. Läuft auf jeder Ebene zuerst, seine Werte haben also Vorrang vor externen Anbietern; Felder, die du beim Bearbeiten eines Eintrags sperrst, haben Vorrang vor beidem."
                  >
                    <Switch
                      id="local-metadata-switch"
                      checked={form.localMetadataEnabled}
                      onCheckedChange={form.toggleLocalMetadata}
                    />
                  </SettingCard>
                </div>
              )}
              {form.hasRemoteProviders ? (
                form.contentLevels.map((level) => (
                  <ProviderLevelSection
                    key={level}
                    level={level}
                    items={form.remoteLevelChains[level] ?? []}
                    onReorder={(newItems) => form.reorderLevel(level, newItems)}
                    onToggleEnabled={(index) => form.toggleLevelProvider(level, index)}
                  />
                ))
              ) : (
                <p className="border-border bg-surface text-muted-foreground rounded-xl border border-dashed p-4 text-center text-xs">
                  Es sind keine Plugins für externe Metadaten-Anbieter installiert. Installiere eins
                  unter Admin → Plugins, um Bilder und Beschreibungen zu laden.
                </p>
              )}
            </>
          ) : (
            <p className="border-border bg-surface text-muted-foreground rounded-xl border border-dashed p-4 text-center text-xs">
              Es sind keine Plugins für Metadaten-Anbieter installiert. Installiere eins unter Admin
              → Plugins, um Bilder und Beschreibungen zu laden.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function AdvancedFields({
  form,
  chapterThumbnailsSupported,
  trickplaySupported,
}: {
  form: LibraryFormController;
  chapterThumbnailsSupported: boolean;
  /** Undefined when the server does not offer seek previews. */
  trickplaySupported?: boolean;
}) {
  return (
    <div className="space-y-3">
      {form.settingSupport.chapterThumbnails && (
        <SettingCard
          htmlFor="chapter-thumbnails-switch"
          title="Kapitel-Vorschaubilder erzeugen"
          description="Speichert Kapitel-Vorschaubilder im Bildspeicher (lokale Festplatte oder S3). Kapitelmarken und Kapitelmenüs funktionieren auch ohne Vorschaubilder."
          footer={
            !chapterThumbnailsSupported ? (
              <p className="text-warning text-xs">
                Der Bildspeicher muss verfügbar sein, bevor das eingeschaltet werden kann. Prüfe ihn
                in den Einstellungen unter Storage &amp; Database.
              </p>
            ) : null
          }
        >
          <Switch
            id="chapter-thumbnails-switch"
            checked={form.chapterThumbnailsEnabled}
            disabled={!chapterThumbnailsSupported}
            onCheckedChange={form.setChapterThumbnailsEnabled}
          />
        </SettingCard>
      )}
      {form.settingSupport.trickplay && trickplaySupported !== undefined && (
        <SettingCard
          htmlFor="trickplay-switch"
          title="Spul-Vorschaubilder erzeugen"
          description="Erzeugt die Vorschaubilder, die Player beim Spulen zeigen, im eingerichteten öffentlichen Asset-Speicher. Die Dateien werden im Hintergrund mit niedriger Priorität verarbeitet. Ausschalten löscht die Vorschaubilder dieser Bibliothek."
          footer={
            !trickplaySupported ? (
              <p className="text-warning text-xs">
                Dafür wird ein öffentlicher Asset-Speicher benötigt.
              </p>
            ) : null
          }
        >
          <Switch
            id="trickplay-switch"
            checked={form.trickplayEnabled}
            disabled={!trickplaySupported && !form.trickplayEnabled}
            onCheckedChange={form.setTrickplayEnabled}
          />
        </SettingCard>
      )}
      {form.settingSupport.introDetection && (
        <SettingCard htmlFor="intro-detection-switch" {...markerDetectionCopy(form.settingSupport)}>
          <Switch
            id="intro-detection-switch"
            checked={form.introDetectionEnabled}
            onCheckedChange={form.setIntroDetectionEnabled}
          />
        </SettingCard>
      )}
    </div>
  );
}

// markerDetectionCopy describes what local marker detection covers in a
// library: movies get best-effort end credits only, episodes get intros and
// credits, and mixed libraries hold both.
function markerDetectionCopy(support: {
  creditsOnlyDetection: boolean;
  movieCreditsDetection: boolean;
}): { title: string; description: string } {
  if (support.creditsOnlyDetection) {
    return {
      title: "Abspann-Marken erkennen (nach bestem Bemühen)",
      description:
        "Sucht in den Filmen dieser Bibliothek nach dem Abspann, anhand eingebetteter Kapitel und des Bildes kurz vor Schluss. Manche Filme bekommen keine Abspann-Marke oder eine, die zu spät beginnt. Dafür muss „Detect credits“ in den Servereinstellungen eingeschaltet sein.",
    };
  }
  const episodes =
    "Analysiert im Hintergrund den Ton der Episoden dieser Bibliothek. Eingebettete Intro- und Abspann-Kapitel werden genutzt, wenn vorhanden.";
  const kinds =
    "„Detect intros“ und „Detect credits“ in den Servereinstellungen legen fest, welche Marken gesucht werden.";
  return {
    title: "Intro- und Abspann-Marken erkennen",
    description: support.movieCreditsDetection
      ? `${episodes} Filme bekommen nur Abspann-Marken, nach bestem Bemühen. ${kinds}`
      : `${episodes} ${kinds}`,
  };
}

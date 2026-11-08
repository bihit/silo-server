import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { AdminSeriesGap, AdminSeriesGapsTMDB } from "@/api/v2/adminSeriesGaps";
import { PageHeader } from "@/components/page/PageHeader";
import { Badge } from "@/components/ui/badge";
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
import { useAdminSeriesGaps } from "@/hooks/queries/admin/seriesGaps";
import { formatEpisodeRanges, seasonLabel } from "@/lib/seriesGaps";

const ALL_LIBRARIES = "__all__";

function episodesLabel(n: number) {
  return n === 1 ? "1 Folge" : `${n} Folgen`;
}

export default function AdminSeriesGaps() {
  const query = useAdminSeriesGaps();
  const [search, setSearch] = useState("");
  const [library, setLibrary] = useState(ALL_LIBRARIES);
  const [showSuspect, setShowSuspect] = useState(true);

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const libraries = useMemo(
    () => [...new Set(items.flatMap((item) => item.libraries))].sort((a, b) => a.localeCompare(b)),
    [items],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (needle && !item.title.toLocaleLowerCase().includes(needle)) return false;
      if (library !== ALL_LIBRARIES && !item.libraries.includes(library)) return false;
      if (!showSuspect && item.missing_seasons.length === 0 && item.seasons.every((s) => s.suspect))
        return false;
      return true;
    });
  }, [items, search, library, showSuspect]);

  const totals = useMemo(() => {
    let seasons = 0;
    let episodes = 0;
    let missingSeasons = 0;
    for (const item of visible) {
      for (const season of item.seasons) {
        if (!showSuspect && season.suspect) continue;
        seasons++;
        episodes += season.missing_count;
      }
      missingSeasons += item.missing_seasons.length;
      episodes += item.missing_seasons.reduce((sum, s) => sum + (s.expected_episodes ?? 0), 0);
    }
    return { series: visible.length, seasons, episodes, missingSeasons };
  }, [visible, showSuspect]);

  return (
    <div className="space-y-5 lg:space-y-6">
      <PageHeader
        title="Fehlende Episoden"
        subtitle="Serien, bei denen Folgen oder Staffeln fehlen: Lücken zwischen den vorhandenen Episoden und, wo der TMDB-Abgleich gelaufen ist, bereits ausgestrahlte Folgen und Staffeln, die auf dem Server fehlen."
        actions={
          <Button
            variant="outline"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching ? "Wird geprüft …" : "Neu prüfen"}
          </Button>
        }
      />

      {query.data ? <TMDBStatus tmdb={query.data.tmdb} /> : null}

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-56 flex-1 space-y-1.5">
          <Label htmlFor="series-gaps-search">Serie suchen</Label>
          <Input
            id="series-gaps-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Titel"
          />
        </div>
        <div className="w-56 space-y-1.5">
          <Label>Bibliothek</Label>
          <Select value={library} onValueChange={setLibrary}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_LIBRARIES}>Alle Bibliotheken</SelectItem>
              {libraries.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch id="series-gaps-suspect" checked={showSuspect} onCheckedChange={setShowSuspect} />
          <Label htmlFor="series-gaps-suspect">Auffällige Nummerierung anzeigen</Label>
        </div>
      </div>

      {query.isPending ? (
        <p className="text-muted-foreground text-sm">Serien werden geprüft …</p>
      ) : query.isError ? (
        <div className="text-destructive space-y-2 text-sm">
          <p>Die Liste konnte nicht geladen werden. {query.error.message}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            Erneut versuchen
          </Button>
        </div>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            {totals.series} Serien · {totals.seasons} Staffeln mit Lücken
            {totals.missingSeasons > 0
              ? ` · ${totals.missingSeasons} fehlende Staffeln`
              : ""} · {totals.episodes} fehlende Folgen
          </p>
          {visible.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {items.length === 0
                ? "Keine fehlenden Folgen gefunden."
                : "Keine Serie passt zum Filter."}
            </p>
          ) : (
            <ul className="divide-border border-border divide-y rounded-lg border">
              {visible.map((item) => (
                <SeriesGapRow key={item.series_id} item={item} showSuspect={showSuspect} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function TMDBStatus({ tmdb }: { tmdb: AdminSeriesGapsTMDB }) {
  if (!tmdb.enabled) {
    return (
      <p className="text-muted-foreground text-sm">
        TMDB-Abgleich ist aus. Ohne eigenen TMDB-Schlüssel erkennt Silo nur Lücken zwischen
        vorhandenen Folgen.
      </p>
    );
  }
  const done = tmdb.checked + tmdb.failed;
  return (
    <p className="text-muted-foreground text-sm">
      {done < tmdb.total
        ? `TMDB-Abgleich läuft im Hintergrund: ${done} von ${tmdb.total} Serien geprüft. Die Liste wird vollständiger, je weiter er ist.`
        : `TMDB-Abgleich: alle ${tmdb.total} Serien geprüft.`}
      {tmdb.failed > 0 ? ` ${tmdb.failed} Serien hat TMDB nicht gefunden.` : ""}
    </p>
  );
}

function SeriesGapRow({ item, showSuspect }: { item: AdminSeriesGap; showSuspect: boolean }) {
  const seasons = item.seasons.filter((season) => showSuspect || !season.suspect);
  return (
    <li className="space-y-2 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          to={`/item/${encodeURIComponent(item.series_id)}`}
          className="font-medium hover:underline"
        >
          {item.title}
          {item.year ? ` (${item.year})` : ""}
        </Link>
        <span className="text-muted-foreground text-xs">
          {item.present_seasons} {item.present_seasons === 1 ? "Staffel" : "Staffeln"} vorhanden
          {item.libraries.length > 0 ? ` · ${item.libraries.join(", ")}` : ""}
        </span>
        {item.tmdb_mismatch ? (
          <Badge
            variant="outline"
            title="Die Nummerierung auf dem Server passt nicht zu den Staffeln bei TMDB. Fehlende Staffeln laut TMDB werden deshalb nicht angezeigt."
          >
            Nummerierung weicht von TMDB ab
          </Badge>
        ) : null}
      </div>
      {item.missing_seasons.length > 0 ? (
        <p className="text-sm">
          <span className="text-muted-foreground">
            {item.missing_seasons.length === 1 ? "Fehlende Staffel: " : "Fehlende Staffeln: "}
          </span>
          {item.missing_seasons
            .map((s) =>
              s.expected_episodes
                ? `${seasonLabel(s.season_number)} (${episodesLabel(s.expected_episodes)})`
                : seasonLabel(s.season_number),
            )
            .join(", ")}
        </p>
      ) : null}
      {seasons.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {seasons.map((season) => {
            const hidden = season.missing_count - season.missing.length;
            return (
              <li key={season.season_number} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-xs">{seasonLabel(season.season_number)}</span>
                <span className="text-muted-foreground text-xs">
                  {season.present} vorhanden
                  {season.expected_episodes != null
                    ? ` von ${season.expected_episodes} laut TMDB`
                    : ""}
                  , {season.missing_count} fehlen
                </span>
                {season.suspect ? (
                  <Badge
                    variant="outline"
                    title={`Mehr Nummern fehlen als vorhanden sind. Meist ist eine Datei falsch nummeriert, z. B. E${season.last_episode}.`}
                  >
                    Nummerierung prüfen
                  </Badge>
                ) : null}
                <span className="basis-full sm:basis-auto">
                  {formatEpisodeRanges(season.missing)}
                  {hidden > 0 ? ` und ${hidden} weitere` : ""}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

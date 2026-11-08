/** Compresses sorted episode numbers into ranges: [3, 7, 8, 9] → "E03, E07–E09". */
export function formatEpisodeRanges(numbers: readonly number[]): string {
  const ranges: [number, number][] = [];
  for (const n of numbers) {
    const last = ranges.at(-1);
    if (last && n === last[1] + 1) last[1] = n;
    else ranges.push([n, n]);
  }
  return ranges
    .map(([start, end]) =>
      start === end ? episodeLabel(start) : `${episodeLabel(start)}–${episodeLabel(end)}`,
    )
    .join(", ");
}

export function episodeLabel(n: number): string {
  return `E${String(n).padStart(2, "0")}`;
}

export function seasonLabel(n: number): string {
  return `S${String(n).padStart(2, "0")}`;
}

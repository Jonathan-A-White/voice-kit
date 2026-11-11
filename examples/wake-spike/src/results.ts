// The headless numbers the page shows: examples/wake-spike/results.json, written by scripts/measure.mjs and bundled when
// the page is built. A page built before the first measuring run has none.

export interface ResultRow {
  measure: string;
  result: string;
  target: string;
  met: 'met' | 'not met' | '-';
}

export interface Results {
  date: string;
  commit: string;
  table: ResultRow[];
}

/** One line per measure, for the page. */
export function summarize(results: Results | undefined): string {
  if (!results || !Array.isArray(results.table)) return 'No headless numbers yet: run `npm run measure --workspace wake-spike`.';
  const lines = results.table.map((row) => `${row.measure}: ${row.result}${row.target !== '-' ? ` (target ${row.target}: ${row.met})` : ''}`);
  return [`Measured ${results.date} at ${results.commit.slice(0, 9)}, headless:`, ...lines].join('\n');
}

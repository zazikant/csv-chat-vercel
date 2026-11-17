/**
 * Format a single value as a CSV cell per RFC 4180: quote it when the value
 * contains a comma, double quote, or newline, and double any embedded
 * quotes. Merely checking for commas (the old behavior) produced corrupt
 * files for values like `Pre-bid "QTO" Webinar` or multi-line subjects.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

"use client";

import { useState, useEffect, useRef } from "react";

interface Props {
  /** "Contacts" or "Mailers" — shown in the modal title */
  entityName: string;
  /** The primary-key field name in the CSV header to look for: "email" or "mailer_id" */
  pkFieldName: "email" | "mailer_id";
  /** Human-readable label for the PK, e.g. "Email" or "Mailer ID" */
  pkLabel: string;
  /** Optional: extra CSV header aliases that also count as the PK column (e.g. ["mailer"] for mailer_id) */
  pkAliases?: string[];
  onClose: () => void;
  /**
   * Called with the array of PKs to delete. Returns a summary object.
   * The parent component routes this to the appropriate DELETE endpoint.
   */
  onDelete: (pks: string[]) => Promise<{ deleted: number; notFound: string[] }>;
}

/**
 * BulkDeleteModal — upload a CSV (or paste a list) of primary keys and delete
 * the matching records in bulk.
 *
 * Behavior:
 *   1. User uploads a CSV file OR pastes a list of PKs (one per line, or
 *      comma-separated).
 *   2. Modal extracts the PK column (looking for `pkFieldName` in CSV headers,
 *      or treats each line as a PK if pasting plain text).
 *   3. Preview: shows how many records will be deleted, with a sample list.
 *   4. User confirms → calls onDelete(pks).
 *   5. Shows results: "Deleted N records. M not found."
 *
 * Safety:
 *   - Requires explicit confirmation (red button)
 *   - Shows a preview before deleting
 *   - Caps at 500 PKs per operation (matches the upload limit)
 */
export default function BulkDeleteModal({
  entityName, pkFieldName, pkLabel, pkAliases = [], onClose, onDelete,
}: Props) {
  const [step, setStep] = useState<"input" | "preview">("input");
  const [fileName, setFileName] = useState("");
  const [textInput, setTextInput] = useState("");
  const [pks, setPks] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ deleted: number; notFound: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function parseCSVLines(text: string): string[][] {
    const result: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const nextCh = text[i + 1];
      if (ch === '"') {
        if (inQuotes && nextCh === '"') { currentCell += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        currentRow.push(currentCell.trim());
        currentCell = "";
      } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (ch === '\r' && nextCh === '\n') i++;
        currentRow.push(currentCell.trim());
        if (currentRow.some(c => c !== "")) result.push(currentRow);
        currentRow = [];
        currentCell = "";
      } else if (ch !== '\r') {
        currentCell += ch;
      }
    }
    if (currentCell.trim() || currentRow.length > 0) {
      currentRow.push(currentCell.trim());
      result.push(currentRow);
    }
    return result;
  }

  /** Parse a CSV file: look for the PK column (or any alias), extract values. */
  function parseCSVFile(text: string): string[] {
    const lines = parseCSVLines(text);
    if (lines.length === 0) return [];

    const rawHeaders = lines[0];
    const headers = rawHeaders.map((h) => h.toLowerCase().trim().replace(/\s+/g, "_"));
    const pkHeaderVariants = new Set([pkFieldName, ...pkAliases].map(h => h.toLowerCase().replace(/\s+/g, "_")));

    // Find the PK column index
    let pkIdx = -1;
    for (let i = 0; i < headers.length; i++) {
      if (pkHeaderVariants.has(headers[i])) {
        pkIdx = i;
        break;
      }
    }

    const out: string[] = [];
    if (pkIdx === -1) {
      // No header match — treat every non-empty cell in column 0 as a PK
      // (common when user pastes a plain list of emails)
      for (let i = 0; i < lines.length; i++) {
        const val = (lines[i][0] || "").trim();
        if (val) out.push(val);
      }
    } else {
      // Skip header row, take column pkIdx from each subsequent row
      for (let i = 1; i < lines.length; i++) {
        const val = (lines[i][pkIdx] || "").trim();
        if (val) out.push(val);
      }
    }
    return out;
  }

  /** Parse plain-text input: one PK per line, or comma-separated. */
  function parsePlainText(text: string): string[] {
    return text
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setTextInput("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const extracted = parseCSVFile(text);
      // De-dupe
      const unique = Array.from(new Set(extracted));
      setPks(unique);
      setStep("preview");
    };
    reader.readAsText(file);
  }

  function handleParseText() {
    if (!textInput.trim()) {
      setError("Please paste at least one " + pkLabel + ".");
      return;
    }
    const extracted = parsePlainText(textInput);
    const unique = Array.from(new Set(extracted));
    if (unique.length === 0) {
      setError("No " + pkLabel + "s found in the input.");
      return;
    }
    setError("");
    setFileName("(pasted text)");
    setPks(unique);
    setStep("preview");
  }

  async function handleDelete() {
    if (pks.length === 0) return;
    if (!confirm(`Delete ${pks.length} ${entityName.toLowerCase()}? This cannot be undone.`)) return;
    setDeleting(true);
    setError("");
    try {
      const r = await onDelete(pks);
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  function reset() {
    setStep("input");
    setFileName("");
    setTextInput("");
    setPks([]);
    setError("");
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-2 sm:mx-auto max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">
            {result ? "Delete Complete" : step === "input" ? `Bulk Delete ${entityName} — CSV / Paste` : `Preview — ${fileName}`}
          </h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {result ? (
          // Results screen
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div className={`px-4 py-3 rounded-lg ${result.deleted > 0 ? "bg-green-50 border border-green-200" : "bg-gray-50 border border-gray-200"}`}>
              <p className="text-sm text-green-700">
                <strong>{result.deleted}</strong> {entityName.toLowerCase()} {result.deleted === 1 ? "was" : "were"} deleted.
              </p>
              {result.notFound.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {result.notFound.length} {pkLabel.toLowerCase()}{(result.notFound.length > 1 ? "s" : "")} not found in the database (already deleted?).
                </p>
              )}
            </div>
            {result.notFound.length > 0 && (
              <details className="cursor-pointer">
                <summary className="text-xs text-gray-500 hover:text-gray-700">View not-found {pkLabel.toLowerCase()}s ({result.notFound.length})</summary>
                <div className="mt-2 max-h-40 overflow-y-auto bg-gray-50 rounded-lg p-3">
                  <pre className="text-xs font-mono text-gray-600 whitespace-pre-wrap break-all">{result.notFound.join("\n")}</pre>
                </div>
              </details>
            )}
          </div>
        ) : step === "input" ? (
          // Input screen
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {error && (
              <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>
            )}

            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Option 1: Upload CSV file</h3>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) {
                    const input = fileInputRef.current!;
                    const dt = new DataTransfer();
                    dt.items.add(f);
                    input.files = dt.files;
                    input.dispatchEvent(new Event("change", { bubbles: true }));
                  }
                }}
                className="w-full border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center cursor-pointer hover:border-red-400 hover:bg-red-50/30 transition-colors"
              >
                <svg className="w-10 h-10 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <p className="text-sm font-medium text-gray-700 mb-1">Drop your CSV here, or click to browse</p>
                <p className="text-xs text-gray-400">Looks for column &quot;{pkFieldName}&quot;{pkAliases.length > 0 ? ` (or ${pkAliases.map(a => `"${a}"`).join(", ")})` : ""} in the header row. If not found, treats column 1 as {pkLabel}.</p>
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" />
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-gray-400">
              <div className="flex-1 border-t border-gray-100" />
              <span>OR</span>
              <div className="flex-1 border-t border-gray-100" />
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Option 2: Paste {pkLabel}s</h3>
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                rows={6}
                placeholder={`Paste ${pkLabel.toLowerCase()}s here, one per line or comma-separated:\n\nuser1@example.com\nuser2@example.com\nuser3@example.com`}
                className="w-full px-3 py-2 text-sm font-mono text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-100 focus:border-red-300 placeholder-gray-400 resize-y"
                spellCheck={false}
              />
              <button
                onClick={handleParseText}
                disabled={!textInput.trim()}
                className="mt-2 px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 rounded-lg transition-colors"
              >
                Parse pasted text
              </button>
            </div>

            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">
              <strong>Warning:</strong> This will permanently delete the matching {entityName.toLowerCase()} from the database.
              Make sure you have a backup. The action cannot be undone.
            </div>
          </div>
        ) : (
          // Preview screen
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <strong>{pks.length}</strong> {entityName.toLowerCase()} will be deleted
              </span>
            </div>

            <div className="flex-1 overflow-auto px-6 py-3">
              <table className="min-w-max text-xs border-collapse">
                <thead className="sticky top-0 bg-gray-50 z-10">
                  <tr>
                    <th className="text-left text-gray-400 font-medium px-3 py-2 w-8">#</th>
                    <th className="text-left text-gray-400 font-medium px-3 py-2">{pkLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {pks.map((pk, i) => (
                    <tr key={i} className="border-b border-gray-100 bg-white">
                      <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-2 text-gray-700 font-mono break-all">{pk}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={reset}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                ← Choose different input
              </button>
              <div className="flex gap-3">
                <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
                <button
                  onClick={handleDelete}
                  disabled={deleting || pks.length === 0}
                  className="px-5 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {deleting ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Deleting...
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Delete {pks.length} {entityName.toLowerCase()}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useRef } from "react";
import { ContactRow } from "@/lib/langgraph/state";

const TEMPLATE_HEADERS: (keyof ContactRow)[] = [
  "email", "name", "company", "designation", "phone",
  "city", "sector", "optin_status", "mailer_id",
  "opens", "clicks", "unsubscribed",
];

const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  name: "Name",
  company: "Company",
  designation: "Designation",
  phone: "Phone",
  city: "City",
  sector: "Sector",
  optin_status: "Opt-in Status",
  mailer_id: "Mailer ID",
  opens: "Opens",
  clicks: "Clicks",
  unsubscribed: "Unsubscribed",
};

interface ParsedRow {
  rowIndex: number;
  data: Partial<ContactRow>;
  errors: string[];
}

interface Props {
  onClose: () => void;
  onUpload: () => void;
}

export default function CSVUploadModal({ onClose, onUpload }: Props) {
  const [step, setStep] = useState<"upload" | "preview">("upload");
  const [fileName, setFileName] = useState("");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function downloadTemplate() {
    const headers = TEMPLATE_HEADERS.map((k) => FIELD_LABELS[k]);
    const example = [
      "rajesh@contractor.com", "Rajesh Kumar", "ABC Contractors",
      "Project Manager", "+91 9876543210", "Mumbai",
      "Infrastructure", "Subscribed", "M001",
      "3", "1", "FALSE",
    ];
    const csv = [headers, example.map((v) => v.includes(",") ? `"${v}"` : v)]
      .map((r) => r.join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "contacts_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function validateRow(index: number, row: Record<string, string>): ParsedRow {
    const errors: string[] = [];
    const data: Partial<ContactRow> = {};

    const str = (v: string | undefined, key: keyof ContactRow) => {
      const trimmed = (v || "").trim();
      if (trimmed) data[key] = trimmed as never;
      return trimmed;
    };
    const num = (v: string | undefined, key: keyof ContactRow) => {
      const trimmed = (v || "").trim();
      if (!trimmed) { (data as Record<string, unknown>)[key] = 0; return; }
      const n = parseInt(trimmed, 10);
      if (!isNaN(n) && n >= 0) (data as Record<string, unknown>)[key] = n;
      else { (data as Record<string, unknown>)[key] = 0; errors.push(`${key} must be a non-negative integer`); }
    };
    const bool = (v: string | undefined, key: keyof ContactRow) => {
      const trimmed = (v || "").trim().toLowerCase();
      (data as Record<string, unknown>)[key] = ["true", "yes", "1", "y"].includes(trimmed);
    };

    str(row.email, "email");
    str(row.name, "name");
    str(row.company, "company");
    str(row.designation, "designation");
    str(row.phone, "phone");
    str(row.city, "city");
    str(row.sector, "sector");
    str(row.optin_status, "optin_status");
    str(row.mailer_id, "mailer_id");
    num(row.opens, "opens");
    num(row.clicks, "clicks");
    bool(row.unsubscribed, "unsubscribed");

    if (!data.email) errors.push("email is required (primary key)");

    return { rowIndex: index, data, errors };
  }

  function parseCSV(text: string): ParsedRow[] {
    const lines = parseCSVLines(text);
    if (lines.length < 2) return [];

    const rawHeaders = lines[0];
    const headers = rawHeaders.map((h) =>
      h.toLowerCase().trim().replace(/\s+/g, "_")
    );

    const fieldKeyMap: Record<string, keyof ContactRow> = {
      email: "email",
      name: "name",
      contact_name: "name",
      company: "company",
      company_name: "company",
      designation: "designation",
      phone: "phone",
      phone_number: "phone",
      city: "city",
      sector: "sector",
      optin_status: "optin_status",
      opt_in_status: "optin_status",
      mailer_id: "mailer_id",
      mailer: "mailer_id",
      opens: "opens",
      open_count: "opens",
      clicks: "clicks",
      click_count: "clicks",
      unsubscribed: "unsubscribed",
      unsub: "unsubscribed",
    };

    const result: ParsedRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i];
      const row: Record<string, string> = {};
      let hasData = false;
      headers.forEach((h, idx) => {
        const key = fieldKeyMap[h] || (h as keyof ContactRow);
        row[key] = values[idx] || "";
        if (values[idx]?.trim()) hasData = true;
      });
      if (hasData) result.push(validateRow(i, row));
    }
    return result;
  }

  function parseCSVLines(text: string): string[][] {
    const result: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const nextCh = text[i + 1];

      if (ch === '"') {
        if (inQuotes && nextCh === '"') {
          currentCell += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        currentRow.push(currentCell.trim());
        currentCell = "";
      } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
        if (ch === '\r' && nextCh === '\n') {
          i++;
        }
        currentRow.push(currentCell.trim());
        if (currentRow.some(c => c !== "")) {
          result.push(currentRow);
        }
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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      setParsedRows(rows);
      setStep("preview");
    };
    reader.readAsText(file);
  }

  async function handleUpload() {
    const validRows = parsedRows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) {
      setUploadError("No valid rows to upload.");
      return;
    }
    setUploading(true);
    setUploadError("");
    try {
      const payload = { rows: validRows.map((r) => r.data) };
      const res = await fetch("/api/contacts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const responseData = await res.json();
      if (!res.ok) {
        throw new Error(responseData.error || "Upload failed");
      }
      onUpload();
      onClose();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const validCount = parsedRows.filter((r) => r.errors.length === 0).length;
  const errorCount = parsedRows.length - validCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">
            {step === "upload" ? "Bulk Upload Contacts — CSV" : `Preview — ${fileName}`}
          </h2>
          <div className="flex items-center gap-3">
            {step === "preview" && (
              <button
                onClick={downloadTemplate}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Template
              </button>
            )}
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {step === "upload" ? (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 gap-6">
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
                className="w-full max-w-md border-2 border-dashed border-gray-200 rounded-2xl p-12 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors"
              >
                <svg className="w-12 h-12 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-sm font-medium text-gray-700 mb-1">Drop your CSV here, or click to browse</p>
                <p className="text-xs text-gray-400">CSV files only — max 500 rows recommended</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              <button
                onClick={downloadTemplate}
                className="px-5 py-2.5 text-sm border border-gray-200 hover:bg-gray-50 rounded-lg transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download CSV Template
              </button>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-400">
                Template fields: <strong>Email</strong> (required), Name, Company, Designation,
                Phone, City, Sector, Opt-in Status (Subscribed / Hard Bounced / Unsubscribed),
                Mailer ID, Opens (int), Clicks (int), Unsubscribed (TRUE/FALSE).
                Engagement (last_activity_date, engagement_score) and Mailer counters are auto-maintained.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                {validCount} valid
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                {errorCount} with errors
              </span>
              <span className="text-gray-400">Total: {parsedRows.length} rows</span>
            </div>

            {uploadError && (
              <div className="mx-6 mt-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                {uploadError}
              </div>
            )}

            <div className="flex-1 overflow-auto px-6 py-3">
              {parsedRows.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-gray-400">
                  No data rows found in file. Make sure headers are in the first row.
                </div>
              ) : (
                <table className="min-w-max text-xs border-collapse">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr>
                      <th className="text-left text-gray-400 font-medium px-2 py-2 w-8">#</th>
                      <th className="text-left text-gray-400 font-medium px-2 py-2 w-20">Status</th>
                      {TEMPLATE_HEADERS.map((h) => (
                        <th key={h} className="text-left text-gray-400 font-medium px-2 py-2 whitespace-nowrap">
                          {FIELD_LABELS[h]}
                        </th>
                      ))}
                      <th className="text-left text-gray-400 font-medium px-2 py-2">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((pr) => (
                      <tr
                        key={pr.rowIndex}
                        className={`border-b border-gray-100 ${pr.errors.length > 0 ? "bg-red-50/50" : "bg-white"}`}
                      >
                        <td className="px-2 py-2 text-gray-400">{pr.rowIndex}</td>
                        <td className="px-2 py-2">
                          {pr.errors.length === 0 ? (
                            <span className="inline-flex items-center gap-1 text-green-600">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> OK
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-500">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> {pr.errors.length} error{pr.errors.length > 1 ? "s" : ""}
                            </span>
                          )}
                        </td>
                        {TEMPLATE_HEADERS.map((h) => {
                          const val = pr.data[h as keyof ContactRow];
                          return (
                            <td key={h} className="px-2 py-2 text-gray-600 max-w-[150px] truncate" title={String(val ?? "")}>
                              {val != null ? String(val) : <span className="text-gray-300">—</span>}
                            </td>
                          );
                        })}
                        <td className="px-2 py-2 text-red-500">
                          {pr.errors.length > 0 ? (
                            <details className="cursor-pointer">
                              <summary className="hover:text-red-700">{pr.errors[0]}{pr.errors.length > 1 ? ` (+${pr.errors.length - 1} more)` : ""}</summary>
                              <ul className="mt-1 list-disc list-inside text-red-400">
                                {pr.errors.map((e, i) => <li key={i}>{e}</li>)}
                              </ul>
                            </details>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => { setStep("upload"); setParsedRows([]); }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
              >
                ← Choose different file
              </button>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  disabled={uploading || validCount === 0}
                  className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {uploading ? `Uploading ${validCount} rows...` : `Upload ${validCount} Row${validCount !== 1 ? "s" : ""}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

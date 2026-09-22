"use client";

import { useState } from "react";
import { ContactRow } from "@/lib/langgraph/state";

// All columns shown in the table.
// Per spec v2:
//   Name | Company | Designation | Email | Phone | Mailer | Opens | Clicks |
//   Unsub | Opt-in | Last Activity | Engagement
const ALL_COLUMNS: { key: keyof ContactRow; label: string }[] = [
  { key: "name",              label: "Name" },
  { key: "company",           label: "Company" },
  { key: "designation",       label: "Designation" },
  { key: "email",             label: "Email" },
  { key: "phone",             label: "Phone" },
  { key: "city",              label: "City" },
  { key: "sector",            label: "Sector" },
  { key: "mailer_id",         label: "Mailer" },
  { key: "opens",             label: "Opens" },
  { key: "clicks",            label: "Clicks" },
  { key: "unsubscribed",      label: "Unsub" },
  { key: "optin_status",      label: "Opt-in" },
  { key: "last_activity_date",label: "Last Activity" },
  { key: "engagement_score",  label: "Engagement" },
];

const VISIBLE_COLUMNS: (keyof ContactRow)[] = [
  "name", "company", "designation", "email", "phone",
  "mailer_id", "opens", "clicks", "unsubscribed",
  "optin_status", "last_activity_date", "engagement_score",
];

const PAGE_SIZE = 25;

const SEARCHABLE_COLUMNS: (keyof ContactRow)[] = [
  "name", "company", "designation", "email", "phone",
  "city", "sector", "optin_status", "engagement_score", "mailer_id",
];

interface Props {
  rows: ContactRow[];
  isFiltered: boolean;
  page: number;
  onPageChange: (page: number) => void;
  onReset: () => void;
  onEdit: (row: ContactRow) => void;
  onAdd: () => void;
  onUpload: () => void;
  onDeleteRows: (emails: string[]) => void;
}

export default function ContactsTable({
  rows, isFiltered, page, onPageChange, onReset, onEdit, onAdd, onUpload, onDeleteRows,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");

  const filteredRows = searchTerm.trim()
    ? rows.filter((row) =>
        SEARCHABLE_COLUMNS.some((col) => {
          const val = row[col];
          if (val === null || val === undefined || val === false) return false;
          return String(val).toLowerCase().includes(searchTerm.toLowerCase());
        })
      )
    : rows;

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const paginated  = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const visibleCols = ALL_COLUMNS.filter((c) => VISIBLE_COLUMNS.includes(c.key));

  const allOnPage = paginated.map((r) => r.email);
  const allSelected = allOnPage.length > 0 && allOnPage.every((e) => selected.has(e));
  const someSelected = allOnPage.some((e) => selected.has(e));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        allOnPage.forEach((e) => next.delete(e));
      } else {
        allOnPage.forEach((e) => next.add(e));
      }
      return next;
    });
  }

  function toggleRow(email: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected record${selected.size > 1 ? "s" : ""}? This cannot be undone.`)) return;
    onDeleteRows(Array.from(selected));
    setSelected(new Set());
  }

  function handleDeleteVisible() {
    if (filteredRows.length === 0) return;
    const isAll = filteredRows.length === rows.length && !searchTerm;
    const msg = isAll
      ? `Delete ALL ${filteredRows.length} records? This cannot be undone.`
      : `Delete ${filteredRows.length} visible record${filteredRows.length > 1 ? "s" : ""}? This cannot be undone.`;
    if (!confirm(msg)) return;
    onDeleteRows(filteredRows.map((r) => r.email));
    setSelected(new Set());
    setSearchTerm("");
  }

  function downloadCSV() {
    const headers = ALL_COLUMNS.map((c) => c.label);
    const rows_data = filteredRows.map((row) =>
      ALL_COLUMNS.map((c) => {
        const val = row[c.key];
        if (val === null || val === undefined || val === false) return "";
        if (typeof val === "string" && val.includes(",")) return `"${val}"`;
        return String(val);
      })
    );
    const csv = [headers, ...rows_data].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatValue(row: ContactRow, key: keyof ContactRow): string {
    const val = row[key];
    if (val === null || val === undefined) return "—";
    if (key === "unsubscribed") return val ? "Yes" : "No";
    if (key === "last_activity_date") {
      try {
        const d = new Date(String(val));
        if (isNaN(d.getTime())) return String(val);
        return d.toLocaleString("en-IN", {
          day: "2-digit", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        });
      } catch {
        return String(val);
      }
    }
    return String(val);
  }

  function getCellClass(key: keyof ContactRow, val: unknown): string {
    if (val === null || val === undefined) return "text-gray-300";
    if (key === "email") return "text-blue-600";
    if (key === "engagement_score") {
      const s = String(val);
      if (s === "HOT")  return "text-red-600    font-medium";
      if (s === "WARM") return "text-orange-500 font-medium";
      if (s === "COLD") return "text-gray-400";
    }
    if (key === "optin_status") {
      const s = String(val);
      if (s === "Subscribed")    return "text-green-600";
      if (s === "Unsubscribed") return "text-red-500";
      if (s === "Hard Bounced") return "text-orange-600";
    }
    if (key === "unsubscribed") return val ? "text-red-500 font-medium" : "text-gray-400";
    if (key === "mailer_id") return val ? "text-gray-600 font-mono text-xs" : "text-gray-300";
    if (key === "opens" || key === "clicks") {
      const n = Number(val);
      if (n > 0) return "text-right font-mono text-gray-700";
      return "text-right font-mono text-gray-300";
    }
    return "text-gray-700";
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Contacts</h2>
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
            {filteredRows.length} {filteredRows.length === 1 ? "record" : "records"}
            {searchTerm && ` (${rows.length} total)`}
          </span>
          {isFiltered && (
            <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">filtered</span>
          )}
          {selected.size > 0 && (
            <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">
              {selected.size} selected
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isFiltered && (
            <button onClick={onReset} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
              Show all
            </button>
          )}
          {searchTerm && (
            <button onClick={() => setSearchTerm("")} className="px-3 py-1.5 text-xs text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors">
              Clear search
            </button>
          )}
          {(searchTerm || isFiltered) && filteredRows.length > 0 && (
            <button onClick={handleDeleteVisible} className="px-3 py-1.5 text-xs bg-red-100 hover:bg-red-200 text-red-600 rounded-lg transition-colors flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete visible ({filteredRows.length})
            </button>
          )}
          <div className="relative">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); onPageChange(1); }}
              placeholder="Search all fields..."
              className="w-48 pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-100 focus:border-blue-300 placeholder-gray-400"
            />
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button onClick={downloadCSV} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            CSV
          </button>
          <button onClick={onUpload} className="px-3 py-1.5 text-xs border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg transition-colors flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload CSV
          </button>
          <button onClick={onAdd} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Contact
          </button>
          {selected.size > 0 && (
            <button onClick={handleBulkDelete} className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete ({selected.size})
            </button>
          )}
        </div>
      </div>

      {/* Horizontal-scroll wrapper: min-w-max forces the table to use its
          natural width so wide column sets scroll instead of being clipped. */}
      <div className="flex-1 overflow-auto">
        {filteredRows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            {searchTerm ? "No records match your search." : "No contacts yet. Click 'Add Contact' or 'Upload CSV' to get started."}
          </div>
        ) : (
          <table className="min-w-max text-sm border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-20">
              <tr>
                <th className="w-10 px-3 py-2.5 border-b border-gray-200 sticky left-0 bg-gray-50 z-30">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer"
                  />
                </th>
                {visibleCols.map((col) => (
                  <th
                    key={col.key}
                    className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-2.5 border-b border-gray-200 whitespace-nowrap"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map((row, i) => (
                <tr
                  key={row.email}
                  onDoubleClick={() => onEdit(row)}
                  className={`border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors group ${
                    i % 2 === 0 ? "bg-white" : "bg-gray-50/30"
                  } ${selected.has(row.email) ? "bg-orange-50" : ""}`}
                >
                  <td className="px-3 py-2 sticky left-0 bg-inherit z-10">
                    <input
                      type="checkbox"
                      checked={selected.has(row.email)}
                      onChange={() => toggleRow(row.email)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer"
                    />
                  </td>
                  {visibleCols.map((col) => {
                    const val = row[col.key as keyof ContactRow];
                    return (
                      <td
                        key={col.key}
                        className={`px-4 py-2.5 whitespace-nowrap ${getCellClass(col.key as keyof ContactRow, val)}`}
                      >
                        {col.key === "email" && val ? (
                          <a
                            href={`mailto:${val}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:underline"
                          >
                            {formatValue(row, col.key as keyof ContactRow)}
                          </a>
                        ) : (
                          formatValue(row, col.key as keyof ContactRow)
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
        <p>
          {selected.size > 0
            ? `${selected.size} of ${rows.length} selected`
            : rows.length === 0 ? "No records" : `Showing ${Math.min((page - 1) * PAGE_SIZE + 1, rows.length)}–${Math.min(page * PAGE_SIZE, rows.length)} of ${rows.length}`}
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(1)}
            disabled={page === 1}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 disabled:opacity-30 transition-colors"
            title="First page"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page === 1}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 disabled:opacity-30 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="px-2 font-medium">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 disabled:opacity-30 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <button
            onClick={() => onPageChange(totalPages)}
            disabled={page === totalPages}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 disabled:opacity-30 transition-colors"
            title="Last page"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

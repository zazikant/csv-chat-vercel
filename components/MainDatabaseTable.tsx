"use client";

import { useState } from "react";
import { MainContactRow } from "@/lib/langgraph/state";

const ALL_COLUMNS: { key: keyof MainContactRow; label: string }[] = [
  { key: "name",        label: "Name" },
  { key: "company",     label: "Company" },
  { key: "designation", label: "Designation" },
  { key: "email",       label: "Email" },
  { key: "phone",       label: "Phone" },
  { key: "city",        label: "City" },
  { key: "sector",      label: "Sector" },
  { key: "tags",        label: "Tags" },
];

const VISIBLE_COLUMNS: (keyof MainContactRow)[] = [
  "name", "company", "designation", "email", "phone", "city", "sector", "tags",
];

const TOTAL_MAILS_SENT_KEY = "_total_mails_sent" as keyof MainContactRow;

const PAGE_SIZE = 25;
const SEARCHABLE_COLUMNS: (keyof MainContactRow)[] = [
  "name", "company", "designation", "email", "phone", "city", "sector", "tags",
];

interface Props {
  rows: MainContactRow[];
  totalMailsSent: Map<string, number>;
  page: number;
  onPageChange: (page: number) => void;
  onReset?: () => void;
  onEdit: (row: MainContactRow) => void;
  onAdd: () => void;
  onUpload: () => void;
  onBulkDelete: () => void;
  onDeleteRows: (emails: string[]) => void;
}

export default function MainDatabaseTable({
  rows, totalMailsSent, page, onPageChange, onReset, onEdit, onAdd, onUpload, onBulkDelete, onDeleteRows,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");

  const filteredRows = searchTerm.trim()
    ? rows.filter((row) =>
        SEARCHABLE_COLUMNS.some((col) => {
          const val = row[col];
          if (val === null || val === undefined) return false;
          if (col === "tags") {
            const tags = val as unknown as string[];
            if (!Array.isArray(tags)) return false;
            return tags.some((t) => typeof t === "string" && t.toLowerCase().includes(searchTerm.toLowerCase()));
          }
          return String(val).toLowerCase().includes(searchTerm.toLowerCase());
        })
      )
    : rows;

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const paginated = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const visibleCols = [...ALL_COLUMNS, { key: TOTAL_MAILS_SENT_KEY, label: "Total Mails Sent" }];
  const allOnPage = paginated.map((r) => r.email);
  const allSelected = allOnPage.length > 0 && allOnPage.every((e) => selected.has(e));
  const someSelected = allOnPage.some((e) => selected.has(e));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) allOnPage.forEach((e) => next.delete(e));
      else allOnPage.forEach((e) => next.add(e));
      return next;
    });
  }
  function toggleRow(email: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(email)) n.delete(email); else n.add(email); return n; });
  }
  function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected record${selected.size > 1 ? "s" : ""}? This will also delete their engagement rows.`)) return;
    onDeleteRows(Array.from(selected));
    setSelected(new Set());
  }
  function downloadCSV() {
    const headers = [...ALL_COLUMNS.map((c) => c.label), "Total Mails Sent"];
    const rowsData = filteredRows.map((row) =>
      [...ALL_COLUMNS.map((c) => {
        const val = row[c.key];
        if (val === null || val === undefined) return "";
        if (c.key === "tags") {
          const tags = val as unknown as string[];
          if (!Array.isArray(tags) || tags.length === 0) return "";
          return `"${tags.join(", ")}"`;
        }
        if (typeof val === "string" && val.includes(",")) return `"${val}"`;
        return String(val);
      }), String(totalMailsSent.get(row.email.toLowerCase()) ?? 0)]
    );
    const csv = [headers, ...rowsData].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `main_database_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatValue(row: MainContactRow, key: keyof MainContactRow): React.ReactNode {
    if (key === TOTAL_MAILS_SENT_KEY) {
      const count = totalMailsSent.get(row.email.toLowerCase()) ?? 0;
      return <span className="font-mono font-medium text-purple-700">{count}</span>;
    }
    const val = row[key];
    if (val === null || val === undefined) return "—";
    if (key === "tags") {
      const tags = val as unknown as string[];
      if (!Array.isArray(tags) || tags.length === 0) return <span className="text-gray-300">—</span>;
      return (
        <div className="flex gap-1 flex-wrap">
          {tags.slice(0, 3).map((t) => (
            <span key={t} className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{t}</span>
          ))}
          {tags.length > 3 && <span className="text-[10px] text-gray-400">+{tags.length - 3}</span>}
        </div>
      );
    }
    return String(val);
  }

  function getCellClass(key: keyof MainContactRow, val: unknown): string {
    if (key === TOTAL_MAILS_SENT_KEY) return "text-right font-mono";
    if (val === null || val === undefined) return "text-gray-300";
    if (key === "email") return "text-blue-600";
    if (key === "tags") return "";
    return "text-gray-700";
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 sm:px-4 py-2 sm:py-3 border-b border-gray-200 bg-white space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-gray-700">Main Database</h2>
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {filteredRows.length} {filteredRows.length === 1 ? "contact" : "contacts"}
            </span>
            {selected.size > 0 && (
              <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">{selected.size} selected</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {onReset && (
            <button onClick={onReset} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">Show all</button>
          )}
          {searchTerm && (
            <button onClick={() => setSearchTerm("")} className="px-3 py-1.5 text-xs text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors">Clear search</button>
          )}
          <div className="relative flex-1 min-w-[120px]">
            <input type="text" value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); onPageChange(1); }} placeholder="Search..." className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-100 focus:border-blue-300 placeholder-gray-400" />
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <button onClick={downloadCSV} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg><span className="hidden sm:inline">CSV</span></button>
          <button onClick={onUpload} className="px-3 py-1.5 text-xs border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg transition-colors flex items-center gap-1.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg><span className="hidden sm:inline">Upload</span></button>
          <button onClick={onBulkDelete} className="px-3 py-1.5 text-xs border border-red-200 hover:bg-red-50 text-red-600 rounded-lg transition-colors flex items-center gap-1.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg><span className="hidden sm:inline">Delete CSV</span></button>
          <button onClick={onAdd} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-1.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg><span className="hidden sm:inline">Add</span></button>
          {selected.size > 0 && (
            <button onClick={handleBulkDelete} className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-1.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>Delete ({selected.size})</button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {filteredRows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            {searchTerm ? "No contacts match your search." : "No contacts yet. Click 'Add' or 'Upload' to get started."}
          </div>
        ) : (
          <table className="min-w-max text-sm border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-20">
              <tr>
                <th className="w-10 px-3 py-2.5 border-b border-gray-200 sticky left-0 bg-gray-50 z-30">
                  <input type="checkbox" checked={allSelected} ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }} onChange={toggleAll} className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" />
                </th>
                {visibleCols.map((col) => (
                  <th key={String(col.key)} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-2.5 border-b border-gray-200 whitespace-nowrap">{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map((row, i) => (
                <tr key={row.email} onDoubleClick={() => onEdit(row)} className={`border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors ${i % 2 === 0 ? "bg-white" : "bg-gray-50/30"} ${selected.has(row.email) ? "bg-orange-50" : ""}`}>
                  <td className="px-3 py-2 sticky left-0 bg-inherit z-10">
                    <input type="checkbox" checked={selected.has(row.email)} onChange={() => toggleRow(row.email)} onClick={(e) => e.stopPropagation()} className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" />
                  </td>
                  {visibleCols.map((col) => {
                    const val = col.key === TOTAL_MAILS_SENT_KEY ? undefined : row[col.key as keyof MainContactRow];
                    return (
                      <td key={String(col.key)} className={`px-4 py-2.5 whitespace-nowrap ${getCellClass(col.key, col.key === TOTAL_MAILS_SENT_KEY ? undefined : val)}`}>
                        {col.key === "email" && val ? (
                          <a href={`mailto:${val}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{formatValue(row, col.key)}</a>
                        ) : (
                          formatValue(row, col.key)
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

      <div className="flex items-center justify-between px-2 sm:px-4 py-2.5 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
        <p>{filteredRows.length === 0 ? "No contacts" : `Showing ${Math.min((page - 1) * PAGE_SIZE + 1, filteredRows.length)}–${Math.min(page * PAGE_SIZE, filteredRows.length)} of ${filteredRows.length}`}</p>
        <div className="flex items-center gap-1">
          <button onClick={() => onPageChange(1)} disabled={page === 1} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 disabled:opacity-30 transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg></button>
          <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page === 1} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 disabled:opacity-30 transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg></button>
          <span className="px-2 font-medium">{page} / {totalPages}</span>
          <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page === totalPages} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 disabled:opacity-30 transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg></button>
          <button onClick={() => onPageChange(totalPages)} disabled={page === totalPages} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-200 disabled:opacity-30 transition-colors"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg></button>
        </div>
      </div>
    </div>
  );
}

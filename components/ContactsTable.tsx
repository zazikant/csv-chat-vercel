"use client";

import { useState } from "react";
import { ContactRow } from "@/lib/langgraph/state";

const ALL_COLUMNS: { key: keyof ContactRow; label: string }[] = [
  { key: "email",             label: "Email" },
  { key: "mailer_id",         label: "Mailer" },
  { key: "opens",             label: "Opens" },
  { key: "clicks",            label: "Clicks" },
  { key: "optin_status",      label: "Opt-in" },
  { key: "engagement_score",  label: "Engagement" },
];

const VISIBLE_COLUMNS: (keyof ContactRow)[] = [
  "email", "mailer_id", "opens", "clicks",
  "optin_status", "engagement_score",
];

const PAGE_SIZE = 25;
const SEARCHABLE_COLUMNS: (keyof ContactRow)[] = [
  "email", "optin_status", "engagement_score", "mailer_id",
];

interface Filters {
  optin_status: string;
  engagement_score: string;
  mailer_id: string;
}
const EMPTY_FILTERS: Filters = { optin_status: "", engagement_score: "", mailer_id: "" };

interface Props {
  rows: ContactRow[];
  page: number;
  onPageChange: (page: number) => void;
  onReset?: () => void;
  onEdit: (row: ContactRow) => void;
  onAdd: () => void;
  onUpload: () => void;
  onBulkDelete: () => void;
  onDeleteRows: (ids: string[]) => void;
}

export default function ContactsTable({
  rows, page, onPageChange, onReset, onEdit, onAdd, onUpload, onBulkDelete, onDeleteRows,
}: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS });
  const [showFilters, setShowFilters] = useState(false);

  const mailerOptions = Array.from(new Set(rows.map((r) => r.mailer_id).filter((x): x is string => !!x))).sort();
  const activeFilterCount = (Object.keys(filters) as (keyof Filters)[]).filter((k) => filters[k] !== "").length;

  const filteredRows = rows.filter((row) => {
    if (searchTerm.trim()) {
      const matches = SEARCHABLE_COLUMNS.some((col) => {
        const val = row[col];
        if (val === null || val === undefined) return false;
        return String(val).toLowerCase().includes(searchTerm.toLowerCase());
      });
      if (!matches) return false;
    }
    if (filters.optin_status && row.optin_status !== filters.optin_status) return false;
    if (filters.engagement_score && row.engagement_score !== filters.engagement_score) return false;
    if (filters.mailer_id === "(none)") {
      if (row.mailer_id) return false;
    } else if (filters.mailer_id && row.mailer_id !== filters.mailer_id) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const paginated = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const visibleCols = ALL_COLUMNS.filter((c) => VISIBLE_COLUMNS.includes(c.key));
  const allOnPage = paginated.map((r) => r.id);
  const allSelected = allOnPage.length > 0 && allOnPage.every((id) => selected.has(id));
  const someSelected = allOnPage.some((id) => selected.has(id));

  function toggleAll() { setSelected((prev) => { const n = new Set(prev); if (allSelected) allOnPage.forEach((id) => n.delete(id)); else allOnPage.forEach((id) => n.add(id)); return n; }); }
  function toggleRow(id: number) { setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function handleBulkDelete() { if (selected.size === 0) return; if (!confirm(`Delete ${selected.size} selected?`)) return; onDeleteRows(Array.from(selected).map(String)); setSelected(new Set()); }
  function downloadCSV() {
    const headers = ALL_COLUMNS.map((c) => c.label);
    const rowsData = filteredRows.map((row) => ALL_COLUMNS.map((c) => { const val = row[c.key]; if (val === null || val === undefined) return ""; if (typeof val === "string" && val.includes(",")) return `"${val}"`; return String(val); }));
    const csv = [headers, ...rowsData].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `contacts_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  function formatValue(row: ContactRow, key: keyof ContactRow): React.ReactNode {
    const val = row[key];
    if (val === null || val === undefined) return "—";
    return String(val);
  }
  function getCellClass(key: keyof ContactRow, val: unknown): string {
    if (val === null || val === undefined) return "text-gray-300";
    if (key === "email") return "text-blue-600";
    if (key === "engagement_score") {
      const s = String(val);
      if (s === "HOT") return "text-red-600 font-medium";
      if (s === "WARM") return "text-orange-500 font-medium";
      if (s === "COLD") return "text-gray-400";
    }
    if (key === "optin_status") {
      const s = String(val);
      if (s === "Subscribed") return "text-green-600";
      if (s === "Unsubscribed") return "text-red-500";
      if (s === "Hard Bounced") return "text-orange-600";
    }
    if (key === "mailer_id") return val ? "text-gray-600 font-mono text-xs" : "text-gray-300";
    if (key === "opens" || key === "clicks") {
      const n = Number(val);
      return n > 0 ? "text-right font-mono text-gray-700" : "text-right font-mono text-gray-300";
    }
    return "text-gray-700";
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 sm:px-4 py-2 sm:py-3 border-b border-gray-200 bg-white space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-semibold text-gray-700">Contacts</h2>
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{filteredRows.length} {filteredRows.length === 1 ? "record" : "records"}</span>
            {selected.size > 0 && <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">{selected.size} selected</span>}
            {activeFilterCount > 0 && <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">{activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {onReset && <button onClick={onReset} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">Show all</button>}
          {searchTerm && <button onClick={() => setSearchTerm("")} className="px-3 py-1.5 text-xs text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors">Clear search</button>}
          <button onClick={() => setShowFilters((s) => !s)} className={`px-3 py-1.5 text-xs rounded-lg transition-colors flex items-center gap-1.5 ${activeFilterCount > 0 || showFilters ? "bg-blue-100 text-blue-700 hover:bg-blue-200" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"}`}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
            Filters {activeFilterCount > 0 && <span className="bg-blue-600 text-white text-[10px] px-1.5 rounded-full">{activeFilterCount}</span>}
          </button>
          <div className="relative flex-1 min-w-[120px]">
            <input type="text" value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); onPageChange(1); }} placeholder="Search..." className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-100 focus:border-blue-300 placeholder-gray-400" />
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <button onClick={downloadCSV} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg><span className="hidden sm:inline">CSV</span></button>
          <button onClick={onUpload} className="px-3 py-1.5 text-xs border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg transition-colors flex items-center gap-1.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg><span className="hidden sm:inline">Upload</span></button>
          <button onClick={onBulkDelete} className="px-3 py-1.5 text-xs border border-red-200 hover:bg-red-50 text-red-600 rounded-lg transition-colors flex items-center gap-1.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg><span className="hidden sm:inline">Delete CSV</span></button>
          <button onClick={onAdd} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-1.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg><span className="hidden sm:inline">Add</span></button>
          {selected.size > 0 && <button onClick={handleBulkDelete} className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-1.5"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>Delete ({selected.size})</button>}
        </div>
      </div>

      {showFilters && (
        <div className="px-2 sm:px-4 py-3 border-b border-gray-200 bg-gray-50/70 flex flex-wrap items-end gap-3">
          <FilterSelect label="Opt-in" value={filters.optin_status} onChange={(v) => { setFilters((f) => ({ ...f, optin_status: v })); onPageChange(1); }} options={[{ value: "", label: "Any status" }, { value: "Subscribed", label: "Subscribed" }, { value: "Hard Bounced", label: "Hard Bounced" }, { value: "Unsubscribed", label: "Unsubscribed" }]} />
          <FilterSelect label="Engagement" value={filters.engagement_score} onChange={(v) => { setFilters((f) => ({ ...f, engagement_score: v })); onPageChange(1); }} options={[{ value: "", label: "Any engagement" }, { value: "HOT", label: "HOT (clicked)" }, { value: "WARM", label: "WARM (opened)" }, { value: "COLD", label: "COLD" }]} />
          <FilterSelect label="Mailer" value={filters.mailer_id} onChange={(v) => { setFilters((f) => ({ ...f, mailer_id: v })); onPageChange(1); }} options={[{ value: "", label: "Any mailer" }, { value: "(none)", label: "(unassigned)" }, ...mailerOptions.map((m) => ({ value: m, label: m }))]} />
          {activeFilterCount > 0 && <button onClick={() => { setFilters({ ...EMPTY_FILTERS }); onPageChange(1); }} className="px-3 py-1.5 text-xs text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors ml-auto">Clear filters ({activeFilterCount})</button>}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {filteredRows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">{searchTerm ? "No records match your search." : "No contacts yet."}</div>
        ) : (
          <table className="min-w-max text-sm border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-20">
              <tr>
                <th className="w-10 px-3 py-2.5 border-b border-gray-200 sticky left-0 bg-gray-50 z-30"><input type="checkbox" checked={allSelected} ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }} onChange={toggleAll} className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" /></th>
                {visibleCols.map((col) => (<th key={String(col.key)} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-2.5 border-b border-gray-200 whitespace-nowrap">{col.label}</th>))}
              </tr>
            </thead>
            <tbody>
              {paginated.map((row, i) => (
                <tr key={row.id} onDoubleClick={() => onEdit(row)} className={`border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors ${i % 2 === 0 ? "bg-white" : "bg-gray-50/30"} ${selected.has(row.id) ? "bg-orange-50" : ""}`}>
                  <td className="px-3 py-2 sticky left-0 bg-inherit z-10"><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} onClick={(e) => e.stopPropagation()} className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" /></td>
                  {visibleCols.map((col) => { const val = row[col.key as keyof ContactRow]; return (<td key={String(col.key)} className={`px-4 py-2.5 whitespace-nowrap ${getCellClass(col.key as keyof ContactRow, val)}`}>{col.key === "email" && val ? <a href={`mailto:${val}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{formatValue(row, col.key as keyof ContactRow)}</a> : formatValue(row, col.key as keyof ContactRow)}</td>); })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between px-2 sm:px-4 py-2.5 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
        <p>{filteredRows.length === 0 ? "No records" : `Showing ${Math.min((page - 1) * PAGE_SIZE + 1, filteredRows.length)}–${Math.min(page * PAGE_SIZE, filteredRows.length)} of ${filteredRows.length}`}</p>
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

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="px-2 py-1.5 text-xs text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-100 focus:border-blue-300 bg-white min-w-[120px]">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

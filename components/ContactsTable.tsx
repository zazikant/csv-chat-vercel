"use client";

import { useEffect, useState, useTransition } from "react";
import { ContactRow } from "@/lib/langgraph/state";
import { useDebounce } from "@/hooks/useDebounce";
import SearchableFilter from "@/components/SearchableFilter";

const ALL_COLUMNS: { key: keyof ContactRow; label: string }[] = [
  { key: "email",             label: "Email" },
  { key: "mailer_id",         label: "Mailer" },
  { key: "opens",             label: "Opens" },
  { key: "clicks",            label: "Clicks" },
  { key: "optin_status",      label: "Opt-in" },
  { key: "engagement_score",  label: "Engagement" },
];

const PAGE_SIZE = 25;

interface Filters {
  optin_status: string;
  engagement_score: string;
  mailer_id: string; // "(none)" = unassigned rows
}
const EMPTY_FILTERS: Filters = { optin_status: "", engagement_score: "", mailer_id: "" };

interface Props {
  // When provided, the parent owns the rows (SQL chat / SQL box override) and
  // we render them as-is. When omitted, we fetch our own page server-side.
  rows?: ContactRow[];
  page: number;
  pageSize?: number;
  total?: number;
  // Incremented by the parent after any mutation (save/delete/upload) —
  // refetches the current page.
  refreshToken?: number;
  onPageChange: (page: number) => void;
  onReset?: () => void;
  onEdit: (row: ContactRow) => void;
  onAdd: () => void;
  onUpload: () => void;
  onBulkDelete: () => void;
  onDeleteRows: (ids: string[]) => void;
}

export default function ContactsTable(props: Props) {
  const {
    rows: externalRows,
    page,
    pageSize = PAGE_SIZE,
    total: externalTotal,
    refreshToken,
    onPageChange,
    onReset,
    onEdit,
    onAdd,
    onUpload,
    onBulkDelete,
    onDeleteRows,
  } = props;

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS });
  const [showFilters, setShowFilters] = useState(false);

  const isServerPaged = externalRows === undefined;
  const [serverRows, setServerRows] = useState<ContactRow[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverLoading, setServerLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const debouncedSearch = useDebounce(searchTerm, 300);
  const debouncedFilters = useDebounce(filters, 200);

  // Full mailer option list (fetched when the Filters panel opens). The
  // visible 25-row page can't provide the complete list.
  const [mailerOptions, setMailerOptions] = useState<string[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  useEffect(() => {
    if (!showFilters || !isServerPaged) return;
    let cancelled = false;
    fetch("/api/contacts/options")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        startTransition(() => {
          setMailerOptions(Array.isArray(json.mailers) ? json.mailers : []);
          setOptionsLoaded(true);
        });
      })
      .catch(() => { /* keep page-derived options on failure */ });
    return () => { cancelled = true; };
  }, [showFilters, isServerPaged, startTransition]);

  // Server-side fetch when in server-paged mode.
  useEffect(() => {
    if (!isServerPaged) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setServerLoading(true);
      setServerError(null);
    });
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
    if (debouncedFilters.optin_status)   params.set("optin", debouncedFilters.optin_status);
    if (debouncedFilters.engagement_score) params.set("engagement", debouncedFilters.engagement_score);
    if (debouncedFilters.mailer_id)      params.set("mailer", debouncedFilters.mailer_id);

    fetch(`/api/contacts?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled) return;
        startTransition(() => {
          setServerRows((json.rows ?? []) as ContactRow[]);
          setServerTotal(Number(json.total ?? 0));
        });
      })
      .catch((err) => { if (!cancelled) setServerError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setServerLoading(false); });
    return () => { cancelled = true; };
  }, [isServerPaged, page, pageSize, debouncedSearch, debouncedFilters, refreshToken]);

  const rows: ContactRow[] = isServerPaged ? serverRows : (externalRows ?? []);
  const total = isServerPaged ? serverTotal : (externalTotal ?? externalRows?.length ?? 0);
  const loading = serverLoading;

  const mailerFilterOptions = (isServerPaged && optionsLoaded)
    ? mailerOptions
    : Array.from(new Set(rows.map((r) => r.mailer_id).filter((x): x is string => !!x))).sort();
  const activeFilterCount = (Object.keys(filters) as (keyof Filters)[]).filter((k) => filters[k] !== "").length;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allOnPage = rows.map((r) => r.id);
  const allSelected = allOnPage.length > 0 && allOnPage.every((id) => selected.has(id));
  const someSelected = allOnPage.some((id) => selected.has(id));

  function toggleAll() { setSelected((prev) => { const n = new Set(prev); if (allSelected) allOnPage.forEach((id) => n.delete(id)); else allOnPage.forEach((id) => n.add(id)); return n; }); }
  function toggleRow(id: number) { setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function handleBulkDelete() { if (selected.size === 0) return; if (!confirm(`Delete ${selected.size} selected?`)) return; onDeleteRows(Array.from(selected).map(String)); setSelected(new Set()); }
  function downloadCSV(mode: "all" | "selected" = "all") {
    // CSV export uses ONLY the currently visible page (server-paged mode) or
    // the override rows. For a full export use the SQL Query Box.
    const exportRows = mode === "selected" ? rows.filter((r) => selected.has(r.id)) : rows;
    if (exportRows.length === 0) return;
    const headers = ALL_COLUMNS.map((c) => c.label);
    const rowsData = exportRows.map((row) => ALL_COLUMNS.map((c) => { const val = row[c.key]; if (val === null || val === undefined) return ""; if (typeof val === "string" && val.includes(",")) return `"${val}"`; return String(val); }));
    const csv = [headers, ...rowsData].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `contacts_${mode}_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
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
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {total} {total === 1 ? "record" : "records"}
              {loading && isServerPaged && <span className="ml-1 text-blue-500">…</span>}
            </span>
            {selected.size > 0 && <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">{selected.size} selected</span>}
            {activeFilterCount > 0 && <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">{activeFilterCount} filter{activeFilterCount > 1 ? "s" : ""}</span>}
            {serverError && <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full" title={serverError}>Error</span>}
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
            <input type="text" value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); onPageChange(1); }} placeholder="Search email / mailer / status..." className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-100 focus:border-blue-300 placeholder-gray-400" />
            {loading && isServerPaged && (
              <svg className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" /><path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
            )}
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <button onClick={() => downloadCSV(selected.size > 0 ? "selected" : "all")} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5" title={selected.size > 0 ? `Export ${selected.size} selected` : `Export current page (${rows.length})`}><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg><span className="hidden sm:inline">{selected.size > 0 ? `CSV (${selected.size})` : "CSV"}</span></button>
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
          <SearchableFilter label="Mailer" value={filters.mailer_id === "(none)" ? "(none)" : filters.mailer_id} onChange={(v) => { setFilters((f) => ({ ...f, mailer_id: v })); onPageChange(1); }} options={["(none)", ...mailerFilterOptions]} />
          {activeFilterCount > 0 && <button onClick={() => { setFilters({ ...EMPTY_FILTERS }); onPageChange(1); }} className="px-3 py-1.5 text-xs text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors ml-auto">Clear filters ({activeFilterCount})</button>}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {rows.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">{searchTerm || activeFilterCount > 0 ? "No records match your search." : "No contacts yet."}</div>
        ) : (
          <table className="min-w-max text-sm border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-20">
              <tr>
                <th className="w-10 px-3 py-2.5 border-b border-gray-200 sticky left-0 bg-gray-50 z-30"><input type="checkbox" checked={allSelected} ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }} onChange={toggleAll} className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" /></th>
                {ALL_COLUMNS.map((col) => (<th key={String(col.key)} className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-2.5 border-b border-gray-200 whitespace-nowrap">{col.label}</th>))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.id} onDoubleClick={() => onEdit(row)} className={`border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors ${i % 2 === 0 ? "bg-white" : "bg-gray-50/30"} ${selected.has(row.id) ? "bg-orange-50" : ""}`}>
                  <td className="px-3 py-2 sticky left-0 bg-inherit z-10"><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} onClick={(e) => e.stopPropagation()} className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer" /></td>
                  {ALL_COLUMNS.map((col) => { const val = row[col.key as keyof ContactRow]; return (<td key={String(col.key)} className={`px-4 py-2.5 whitespace-nowrap ${getCellClass(col.key as keyof ContactRow, val)}`}>{col.key === "email" && val ? <a href={`mailto:${val}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{formatValue(row, col.key as keyof ContactRow)}</a> : formatValue(row, col.key as keyof ContactRow)}</td>); })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between px-2 sm:px-4 py-2.5 border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
        <p>{total === 0 ? "No records" : `Showing ${Math.min((page - 1) * pageSize + 1, total)}–${Math.min(page * pageSize, total)} of ${total}`}</p>
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

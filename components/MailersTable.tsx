"use client";

import { useState } from "react";
import { MailerRow } from "@/lib/langgraph/state";

const ALL_COLUMNS: { key: keyof MailerRow; label: string }[] = [
  { key: "mailer_id",          label: "Mailer ID" },
  { key: "subject_line",       label: "Subject Line" },
  { key: "template_name",     label: "Template" },
  { key: "sent_date",         label: "Sent Date" },
  { key: "total_sent",        label: "Sent" },
  { key: "unique_opens",      label: "Unique Opens" },
  { key: "total_opens",       label: "Total Opens" },
  { key: "unique_clicks",     label: "Unique Clicks" },
  { key: "total_clicks",      label: "Total Clicks" },
  { key: "unsubscribed_count",label: "Unsubscribed" },
  { key: "hardbounced_count",label: "Hard Bounced" },
  { key: "open_rate",         label: "Open Rate" },
  { key: "click_rate",        label: "Click Rate" },
  { key: "unsubscribe_rate",  label: "Unsub Rate" },
  { key: "hardbounce_rate",   label: "Bounce Rate" },
];

const VISIBLE_COLUMNS: (keyof MailerRow)[] = [
  "mailer_id", "subject_line", "sent_date",
  "total_sent", "unique_opens", "unique_clicks",
  "unsubscribed_count", "hardbounced_count",
  "open_rate", "click_rate", "unsubscribe_rate", "hardbounce_rate",
];

const PAGE_SIZE = 25;
const SEARCHABLE_COLUMNS: (keyof MailerRow)[] = [
  "mailer_id", "subject_line", "template_name",
];

interface Props {
  rows: MailerRow[];
  page: number;
  onPageChange: (page: number) => void;
  onReset?: () => void;  // optional - shown when SQL query replaces the visible rows
  onEdit: (row: MailerRow) => void;
  onAdd: () => void;
  onBulkDelete: () => void;
  onDeleteRows: (ids: string[]) => void;
}

interface MailerFilters {
  min_open_rate: string;       // number, "" = any
  min_click_rate: string;      // number
  min_unsubscribe_rate: string;
  min_hardbounce_rate: string;
  sent_after: string;          // YYYY-MM-DD
  sent_before: string;         // YYYY-MM-DD
  has_unsubscribed: string;    // "" any / "yes" / "no"
  has_hardbounced: string;
}

const EMPTY_FILTERS: MailerFilters = {
  min_open_rate: "", min_click_rate: "", min_unsubscribe_rate: "", min_hardbounce_rate: "",
  sent_after: "", sent_before: "", has_unsubscribed: "", has_hardbounced: "",
};

export default function MailersTable({
  rows, page, onPageChange, onReset, onEdit, onAdd, onBulkDelete, onDeleteRows,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<keyof MailerRow | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filters, setFilters] = useState<MailerFilters>({ ...EMPTY_FILTERS });
  const [showFilters, setShowFilters] = useState(false);
  const activeFilterCount = (Object.keys(filters) as (keyof MailerFilters)[]).filter((k) => filters[k] !== "").length;

  let filteredRows = searchTerm.trim()
    ? rows.filter((row) =>
        SEARCHABLE_COLUMNS.some((col) => {
          const val = row[col];
          if (val === null || val === undefined) return false;
          return String(val).toLowerCase().includes(searchTerm.toLowerCase());
        })
      )
    : rows;

  // Apply structured filters
  filteredRows = filteredRows.filter((row) => {
    if (filters.min_open_rate) {
      const min = parseFloat(filters.min_open_rate);
      if (!isNaN(min) && (row.open_rate ?? 0) < min) return false;
    }
    if (filters.min_click_rate) {
      const min = parseFloat(filters.min_click_rate);
      if (!isNaN(min) && (row.click_rate ?? 0) < min) return false;
    }
    if (filters.min_unsubscribe_rate) {
      const min = parseFloat(filters.min_unsubscribe_rate);
      if (!isNaN(min) && (row.unsubscribe_rate ?? 0) < min) return false;
    }
    if (filters.min_hardbounce_rate) {
      const min = parseFloat(filters.min_hardbounce_rate);
      if (!isNaN(min) && (row.hardbounce_rate ?? 0) < min) return false;
    }
    if (filters.sent_after) {
      const after = new Date(filters.sent_after).getTime();
      if (!isNaN(after)) {
        const sent = row.sent_date ? new Date(row.sent_date).getTime() : 0;
        if (sent < after) return false;
      }
    }
    if (filters.sent_before) {
      const before = new Date(filters.sent_before).getTime();
      if (!isNaN(before)) {
        const sent = row.sent_date ? new Date(row.sent_date).getTime() : 0;
        if (sent > before) return false;
      }
    }
    if (filters.has_unsubscribed === "yes" && (row.unsubscribed_count ?? 0) === 0) return false;
    if (filters.has_unsubscribed === "no"  && (row.unsubscribed_count ?? 0) > 0) return false;
    if (filters.has_hardbounced === "yes" && (row.hardbounced_count ?? 0) === 0) return false;
    if (filters.has_hardbounced === "no"  && (row.hardbounced_count ?? 0) > 0) return false;
    return true;
  });

  if (sortBy) {
    filteredRows = [...filteredRows].sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const ac = String(av);
      const bc = String(bv);
      return sortDir === "asc" ? ac.localeCompare(bc) : bc.localeCompare(ac);
    });
  }

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const paginated  = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const visibleCols = ALL_COLUMNS.filter((c) => VISIBLE_COLUMNS.includes(c.key));

  const allOnPage = paginated.map((r) => r.mailer_id);
  const allSelected = allOnPage.length > 0 && allOnPage.every((id) => selected.has(id));
  const someSelected = allOnPage.some((id) => selected.has(id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        allOnPage.forEach((id) => next.delete(id));
      } else {
        allOnPage.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected mailer${selected.size > 1 ? "s" : ""}? This will also unset mailer_id on any contacts assigned to them. This cannot be undone.`)) return;
    onDeleteRows(Array.from(selected));
    setSelected(new Set());
  }

  function handleSort(key: keyof MailerRow) {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
    onPageChange(1);
  }

  function downloadCSV() {
    const headers = ALL_COLUMNS.map((c) => c.label);
    const rows_data = filteredRows.map((row) =>
      ALL_COLUMNS.map((c) => {
        const val = row[c.key];
        if (val === null || val === undefined) return "";
        if (typeof val === "string" && val.includes(",")) return `"${val}"`;
        return String(val);
      })
    );
    const csv = [headers, ...rows_data].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mailers_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatValue(row: MailerRow, key: keyof MailerRow): string {
    const val = row[key];
    if (val === null || val === undefined) return "—";
    if (key === "sent_date") {
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
    if (key === "open_rate" || key === "click_rate" || key === "unsubscribe_rate") {
      const n = Number(val);
      if (isNaN(n)) return String(val);
      return `${n.toFixed(2)}%`;
    }
    return String(val);
  }

  function getCellClass(key: keyof MailerRow, val: unknown): string {
    if (val === null || val === undefined) return "text-gray-300";
    if (key === "open_rate" || key === "click_rate") {
      const n = Number(val);
      if (!isNaN(n)) {
        if (n >= 30) return "text-green-600 font-medium";
        if (n >= 10) return "text-blue-600";
        if (n > 0)   return "text-orange-500";
        return "text-gray-400";
      }
    }
    if (key === "unsubscribe_rate" || key === "hardbounce_rate") {
      const n = Number(val);
      if (!isNaN(n)) {
        if (n >= 5)  return "text-red-600 font-medium";
        if (n >= 1)  return "text-orange-500";
        return "text-gray-400";
      }
    }
    if (key === "unsubscribed_count" || key === "hardbounced_count") {
      const n = Number(val);
      return n > 0 ? "text-red-500 font-medium" : "text-gray-400";
    }
    if (key === "subject_line") return "text-gray-800";
    if (key === "mailer_id")    return "text-gray-500 font-mono";
    if (typeof val === "number") return "text-right font-mono text-gray-700";
    return "text-gray-700";
  }

  return (
    <div className="flex flex-col h-full">
      <div className="space-y-2 px-2 sm:px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Mailers</h2>
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
            {filteredRows.length} {filteredRows.length === 1 ? "mailer" : "mailers"}
            {searchTerm && ` (${rows.length} total)`}
          </span>
          {selected.size > 0 && (
            <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">
              {selected.size} selected
            </span>
          )}
          {sortBy && (
            <button
              onClick={() => { setSortBy(null); onPageChange(1); }}
              className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full hover:bg-purple-200 transition-colors"
            >
              sorted by {String(sortBy)} {sortDir === "asc" ? "↑" : "↓"} ×
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onReset && (
            <button
              onClick={onReset}
              className="px-3 py-1.5 text-xs text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors flex items-center gap-1.5"
              title="Reset to full mailers list"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Show all
            </button>
          )}
          {searchTerm && (
            <button onClick={() => setSearchTerm("")} className="px-3 py-1.5 text-xs text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors">
              Clear search
            </button>
          )}
          {/* Filters toggle button */}
          <button
            onClick={() => setShowFilters((s) => !s)}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors flex items-center gap-1.5 ${
              activeFilterCount > 0 || showFilters
                ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            }`}
            title="Toggle filters"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
            {activeFilterCount > 0 && (
              <span className="bg-blue-600 text-white text-[10px] px-1.5 rounded-full">{activeFilterCount}</span>
            )}
          </button>
          <div className="relative">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); onPageChange(1); }}
              placeholder="Search subject / ID..."
              className="flex-1 min-w-[120px] pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-100 focus:border-blue-300 placeholder-gray-400"
            />
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <button onClick={downloadCSV} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span className="hidden sm:inline">CSV</span>
          </button>
          <button onClick={onBulkDelete} className="px-3 py-1.5 text-xs border border-red-200 hover:bg-red-50 text-red-600 rounded-lg transition-colors flex items-center gap-1.5" title="Bulk delete mailers via CSV or pasted mailer_id list">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span className="hidden sm:inline">Delete CSV</span>
          </button>
          <button onClick={onAdd} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="hidden sm:inline">Add Mailer</span>
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

      {/* Filter bar — shown when toggle is on */}
      {showFilters && (
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50/70 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Min Open Rate (%)</label>
            <input
              type="number" min={0} max={100} step={1}
              value={filters.min_open_rate}
              onChange={(e) => { setFilters((f) => ({ ...f, min_open_rate: e.target.value })); onPageChange(1); }}
              placeholder="e.g. 50"
              className="w-24 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-100 focus:border-blue-300"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Min Click Rate (%)</label>
            <input
              type="number" min={0} max={100} step={1}
              value={filters.min_click_rate}
              onChange={(e) => { setFilters((f) => ({ ...f, min_click_rate: e.target.value })); onPageChange(1); }}
              placeholder="e.g. 10"
              className="w-24 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-100 focus:border-blue-300"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Min Unsub Rate (%)</label>
            <input
              type="number" min={0} max={100} step={0.1}
              value={filters.min_unsubscribe_rate}
              onChange={(e) => { setFilters((f) => ({ ...f, min_unsubscribe_rate: e.target.value })); onPageChange(1); }}
              placeholder="e.g. 1"
              className="w-24 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-100 focus:border-blue-300"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Min Bounce Rate (%)</label>
            <input
              type="number" min={0} max={100} step={0.1}
              value={filters.min_hardbounce_rate}
              onChange={(e) => { setFilters((f) => ({ ...f, min_hardbounce_rate: e.target.value })); onPageChange(1); }}
              placeholder="e.g. 1"
              className="w-24 px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-100 focus:border-blue-300"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Sent After</label>
            <input
              type="date"
              value={filters.sent_after}
              onChange={(e) => { setFilters((f) => ({ ...f, sent_after: e.target.value })); onPageChange(1); }}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-100 focus:border-blue-300"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Sent Before</label>
            <input
              type="date"
              value={filters.sent_before}
              onChange={(e) => { setFilters((f) => ({ ...f, sent_before: e.target.value })); onPageChange(1); }}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-100 focus:border-blue-300"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Has Unsubscribed?</label>
            <select
              value={filters.has_unsubscribed}
              onChange={(e) => { setFilters((f) => ({ ...f, has_unsubscribed: e.target.value })); onPageChange(1); }}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-100 focus:border-blue-300 bg-white"
            >
              <option value="">Any</option>
              <option value="yes">Yes (≥1)</option>
              <option value="no">No (=0)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Has Hard Bounced?</label>
            <select
              value={filters.has_hardbounced}
              onChange={(e) => { setFilters((f) => ({ ...f, has_hardbounced: e.target.value })); onPageChange(1); }}
              className="px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-100 focus:border-blue-300 bg-white"
            >
              <option value="">Any</option>
              <option value="yes">Yes (≥1)</option>
              <option value="no">No (=0)</option>
            </select>
          </div>
          {activeFilterCount > 0 && (
            <button
              onClick={() => { setFilters({ ...EMPTY_FILTERS }); onPageChange(1); }}
              className="px-3 py-1.5 text-xs text-orange-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors ml-auto"
            >
              Clear filters ({activeFilterCount})
            </button>
          )}
        </div>
      )}

      {/* Horizontal-scroll wrapper */}
      <div className="flex-1 overflow-auto">
        {filteredRows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            {searchTerm ? "No mailers match your search." : "No mailers yet. Click 'Add Mailer' to create your first campaign."}
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
                    onClick={() => handleSort(col.key)}
                    className={`text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-2.5 border-b border-gray-200 whitespace-nowrap cursor-pointer hover:bg-gray-100 transition-colors ${sortBy === col.key ? "bg-blue-50/50" : ""}`}
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      {sortBy === col.key && (
                        <span className="text-blue-500">{sortDir === "asc" ? "↑" : "↓"}</span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.map((row, i) => (
                <tr
                  key={row.mailer_id}
                  onDoubleClick={() => onEdit(row)}
                  className={`border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors group ${
                    i % 2 === 0 ? "bg-white" : "bg-gray-50/30"
                  } ${selected.has(row.mailer_id) ? "bg-orange-50" : ""}`}
                >
                  <td className="px-3 py-2 sticky left-0 bg-inherit z-10">
                    <input
                      type="checkbox"
                      checked={selected.has(row.mailer_id)}
                      onChange={() => toggleRow(row.mailer_id)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer"
                    />
                  </td>
                  {visibleCols.map((col) => (
                    <td
                      key={col.key}
                      className={`px-4 py-2.5 whitespace-nowrap ${getCellClass(col.key as keyof MailerRow, row[col.key as keyof MailerRow])}`}
                    >
                      {col.key === "subject_line"
                        ? (row.subject_line?.length > 60 ? row.subject_line.slice(0, 60) + "…" : row.subject_line)
                        : formatValue(row, col.key as keyof MailerRow)}
                    </td>
                  ))}
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
            : rows.length === 0 ? "No mailers" : `Showing ${Math.min((page - 1) * PAGE_SIZE + 1, rows.length)}–${Math.min(page * PAGE_SIZE, rows.length)} of ${rows.length}`}
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
          <span className="px-2 font-medium">{page} / {totalPages}</span>
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

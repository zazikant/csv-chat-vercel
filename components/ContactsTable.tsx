"use client";

import { useState } from "react";
import { ContactRow } from "@/lib/langgraph/state";

const ALL_COLUMNS: { key: keyof ContactRow; label: string }[] = [
  { key: "proposal_number",        label: "Proposal #" },
  { key: "project_name",           label: "Project" },
  { key: "company_name",          label: "Company" },
  { key: "status",                label: "Status" },
  { key: "department",            label: "Dept" },
  { key: "proposal_value_inr",    label: "Value (₹)" },
  { key: "proposal_enquiry_for",  label: "Service/Scope" },
  { key: "enquiry_received_date", label: "Enquiry Date" },
  { key: "proposal_sent_date",    label: "Sent Date" },
  { key: "name",                   label: "Contact" },
  { key: "email",                 label: "Email" },
  { key: "phone_number",          label: "Phone" },
  { key: "city",                  label: "City" },
  { key: "designation",           label: "Designation" },
  { key: "type_of_customer",      label: "Customer Type" },
  { key: "existing_new_customer", label: "Existing/New" },
  { key: "sector",               label: "Sector" },
  { key: "go_no_go_decision",     label: "Go/No-Go" },
  { key: "inbound_outbound",      label: "In/Out" },
  { key: "quotation_method",      label: "Quote Method" },
  { key: "mode_of_submission",    label: "Mode" },
  { key: "remarks",               label: "Remarks" },
];

const VISIBLE_COLUMNS = [
  "proposal_number", "project_name", "company_name", "name",
  "status", "department", "go_no_go_decision", "proposal_value_inr",
  "proposal_enquiry_for", "quotation_method", "enquiry_received_date",
  "proposal_sent_date", "mode_of_submission", "inbound_outbound",
  "existing_new_customer", "type_of_customer", "sector", "city",
  "email", "phone_number", "designation", "remarks",
];

const PAGE_SIZE = 25;

const SEARCHABLE_COLUMNS: (keyof ContactRow)[] = [
  "proposal_number", "project_name", "company_name", "name", "email",
  "phone_number", "city", "designation", "status", "department",
  "go_no_go_decision", "inbound_outbound", "existing_new_customer",
  "type_of_customer", "sector", "quotation_method", "mode_of_submission",
  "remarks", "proposal_enquiry_for",
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
  onDeleteRows: (ids: number[]) => void;
}

export default function ContactsTable({
  rows, isFiltered, page, onPageChange, onReset, onEdit, onAdd, onUpload, onDeleteRows,
}: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");

  const filteredRows = searchTerm.trim()
    ? rows.filter((row) =>
        SEARCHABLE_COLUMNS.some((col) => {
          const val = row[col];
          if (val === null || val === undefined) return false;
          return String(val).toLowerCase().includes(searchTerm.toLowerCase());
        })
      )
    : rows;

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const paginated  = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const visibleCols = ALL_COLUMNS.filter((c) => VISIBLE_COLUMNS.includes(c.key as string));

  const allOnPage = paginated.map((r) => r.id);
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

  function toggleRow(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected record${selected.size > 1 ? "s" : ""}? This cannot be undone.`)) return;
    onDeleteRows(Array.from(selected));
    setSelected(new Set());
  }

  function downloadCSV() {
    const headers = ALL_COLUMNS.map((c) => c.label);
    const rows_data = rows.map((row) =>
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
    a.download = `proposals_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function formatValue(row: ContactRow, key: keyof ContactRow): string {
    const val = row[key];
    if (val === null || val === undefined) return "—";
    if (key === "proposal_value_inr") return new Intl.NumberFormat("en-IN").format(Number(val));
    const str = String(val);
    if (key === "remarks") return str.length > 60 ? str.slice(0, 60) + "…" : str;
    return str;
  }

  function getCellClass(key: keyof ContactRow, val: unknown): string {
    if (val === null || val === undefined) return "text-gray-300";
    if (key === "email") return "text-blue-600";
    if (key === "status") {
      const s = String(val);
      if (s === "Won") return "text-green-600 font-medium";
      if (s === "Loss") return "text-red-500";
      if (s === "Open") return "text-blue-600 font-medium";
      if (s === "Closed") return "text-gray-500";
    }
    if (key === "go_no_go_decision") {
      const s = String(val);
      if (s === "Approved") return "text-green-600";
      if (s === "Not Approved") return "text-red-500";
      if (s === "Pending") return "text-yellow-600";
    }
    if (key === "inbound_outbound") {
      const s = String(val);
      if (s === "Inbound") return "text-purple-600";
      if (s === "Outbound") return "text-orange-600";
    }
    if (key === "proposal_value_inr") return "text-right font-mono text-gray-700";
    if (key === "remarks") return "text-gray-500 text-xs";
    return "text-gray-700";
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Proposals</h2>
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
            Add Record
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

      <div className="flex-1 overflow-auto">
        {filteredRows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            {searchTerm ? "No records match your search." : "No records match your query."}
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-20">
              <tr>
                <th className="w-10 px-3 py-2.5 border-b border-gray-200">
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
                  key={row.id}
                  onDoubleClick={() => onEdit(row)}
                  className={`border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors group ${
                    i % 2 === 0 ? "bg-white" : "bg-gray-50/30"
                  } ${selected.has(row.id) ? "bg-orange-50" : ""}`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleRow(row.id)}
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

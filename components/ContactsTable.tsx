"use client";

import { ContactRow } from "@/lib/langgraph/state";

const ALL_COLUMNS: { key: keyof ContactRow; label: string }[] = [
  { key: "proposal_number",        label: "Proposal #" },
  { key: "project_name",           label: "Project" },
  { key: "company_name",          label: "Company" },
  { key: "name",                   label: "Contact" },
  { key: "email",                 label: "Email" },
  { key: "phone_number",          label: "Phone" },
  { key: "designation",           label: "Designation" },
  { key: "type_of_customer",      label: "Customer Type" },
  { key: "existing_new_customer",label: "Existing/New" },
  { key: "sector",                label: "Sector" },
  { key: "city",                  label: "City" },
  { key: "status",                label: "Status" },
  { key: "department",            label: "Dept" },
  { key: "go_no_go_decision",     label: "Go/No-Go" },
  { key: "inbound_outbound",      label: "In/Out" },
  { key: "proposal_enquiry_for",  label: "For" },
  { key: "quotation_method",      label: "Quote Method" },
  { key: "proposal_value_inr",    label: "Value (₹)" },
  { key: "enquiry_received_date", label: "Enquiry Date" },
  { key: "proposal_sent_date",    label: "Sent Date" },
  { key: "mode_of_submission",    label: "Mode" },
  { key: "remarks",               label: "Remarks" },
];

const VISIBLE_COLUMNS = [
  "proposal_number", "project_name", "company_name", "status",
  "department", "proposal_value_inr", "proposal_enquiry_for",
  "enquiry_received_date", "proposal_sent_date", "name", "email",
  "phone_number", "city",
];

interface Props {
  rows: ContactRow[];
  isFiltered: boolean;
  onReset: () => void;
  onEdit: (row: ContactRow) => void;
  onAdd: () => void;
  onUpload: () => void;
}

export default function ContactsTable({ rows, isFiltered, onReset, onEdit, onAdd, onUpload }: Props) {
  const visibleCols = ALL_COLUMNS.filter((c) => VISIBLE_COLUMNS.includes(c.key as string));

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
    if (key === "proposal_value_inr") {
      return new Intl.NumberFormat("en-IN").format(Number(val));
    }
    return String(val);
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
    if (key === "proposal_value_inr") return "text-right font-mono text-gray-700";
    return "text-gray-700";
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Proposals</h2>
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
            {rows.length} {rows.length === 1 ? "record" : "records"}
          </span>
          {isFiltered && (
            <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
              filtered
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isFiltered && (
            <button
              onClick={onReset}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Show all
            </button>
          )}
          <button
            onClick={downloadCSV}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            CSV
          </button>
          <button
            onClick={onUpload}
            className="px-3 py-1.5 text-xs border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Upload CSV
          </button>
          <button
            onClick={onAdd}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Record
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            No records match your query.
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr>
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
              {rows.map((row, i) => (
                <tr
                  key={row.id}
                  onDoubleClick={() => onEdit(row)}
                  className={`border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors ${
                    i % 2 === 0 ? "bg-white" : "bg-gray-50/30"
                  }`}
                >
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

      <div className="px-4 py-2 border-t border-gray-200 bg-gray-50">
        <p className="text-xs text-gray-400">Double-click any row to edit</p>
      </div>
    </div>
  );
}

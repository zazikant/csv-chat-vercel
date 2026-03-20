"use client";

import { ContactRow } from "@/lib/langgraph/state";

interface Props {
  rows: ContactRow[];
  isFiltered: boolean;
  onReset: () => void;
}

export default function ContactsTable({ rows, isFiltered, onReset }: Props) {
  const columns = [
    { key: "name",         label: "Name" },
    { key: "email",        label: "Email" },
    { key: "company_name", label: "Company" },
    { key: "phone_number", label: "Phone" },
    { key: "city",         label: "City" },
    { key: "designation",  label: "Designation" },
  ] as const;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Contacts</h2>
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
            {rows.length} {rows.length === 1 ? "record" : "records"}
          </span>
          {isFiltered && (
            <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
              filtered
            </span>
          )}
        </div>
        {isFiltered && (
          <button
            onClick={onReset}
            className="text-xs text-gray-400 hover:text-gray-700 underline transition-colors"
          >
            Show all
          </button>
        )}
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
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider px-4 py-2 border-b border-gray-200 whitespace-nowrap"
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
                  className={`border-b border-gray-100 hover:bg-blue-50 transition-colors ${
                    i % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                  }`}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className="px-4 py-2.5 text-gray-700 whitespace-nowrap"
                    >
                      {col.key === "email" ? (
                        <span className="text-blue-600">{row[col.key]}</span>
                      ) : (
                        row[col.key]
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

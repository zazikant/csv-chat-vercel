"use client";

import { useState } from "react";

/**
 * Searchable filter with search box — for filter fields that can have many
 * values (Sector, Source, Tag, Assigned To, City, Mailer, …).
 * Shared by MainDatabaseTable, ContactsTable and MailersTable.
 */
export default function SearchableFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = search.trim()
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <div className="flex flex-col gap-1 relative">
      <label className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{label}</label>
      <button
        onClick={() => setOpen((o) => !o)}
        className="px-2 py-1.5 text-xs text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-100 focus:border-blue-300 bg-white min-w-[120px] flex items-center justify-between gap-1"
      >
        <span className={value ? "text-gray-900" : "text-gray-400"}>{value || `Any ${label.toLowerCase()}`}</span>
        <svg className={`w-3 h-3 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setSearch(""); }} />
          <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-hidden flex flex-col">
            <div className="p-2 border-b border-gray-100">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                className="w-full px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-100"
                autoFocus
              />
            </div>
            <div className="overflow-y-auto flex-1">
              <button
                onClick={() => { onChange(""); setOpen(false); setSearch(""); }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${!value ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"}`}
              >
                Any {label.toLowerCase()}
              </button>
              {filtered.map((opt) => (
                <button
                  key={opt}
                  onClick={() => { onChange(opt); setOpen(false); setSearch(""); }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${value === opt ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"}`}
                >
                  {opt}
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="px-3 py-2 text-xs text-gray-400">No matches</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

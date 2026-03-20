"use client";

import { useState, useEffect, useRef } from "react";

interface Props {
  column: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}

export default function FieldSuggest({ column, value, onChange, placeholder, className = "" }: Props) {
  const [query, setQuery] = useState(value);
  const [allValues, setAllValues] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    fetch(`/api/contacts/values?column=${encodeURIComponent(column)}`)
      .then((r) => r.json())
      .then((d) => setAllValues(d.values || []));
  }, [column]);

  const suggestions = query.trim()
    ? allValues.filter((v) => v.toLowerCase().includes(query.toLowerCase())).slice(0, 20)
    : allValues.slice(0, 20);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    onChange(v);
    setShowDropdown(true);
    setHighlight(0);
  }

  function handleSelect(v: string) {
    setQuery(v);
    onChange(v);
    setShowDropdown(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown || suggestions.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); handleSelect(suggestions[highlight]); }
    if (e.key === "Escape") { e.preventDefault(); setShowDropdown(false); }
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!dropdownRef.current?.contains(e.target as Node) && !inputRef.current?.parentElement?.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const show = showDropdown && suggestions.length > 0;

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowDropdown(true)}
          placeholder={placeholder || "Type..."}
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 placeholder-gray-600"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => { setShowDropdown((s) => !s); inputRef.current?.focus(); }}
          title="Show suggestions"
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        </button>
      </div>
      {show && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl max-h-52 overflow-y-auto"
        >
          {suggestions.map((s, i) => (
            <div
              key={s}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
              onMouseEnter={() => setHighlight(i)}
              className={`px-4 py-2.5 text-sm cursor-pointer flex items-center gap-2 ${
                i === highlight ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-50"
              } ${i === 0 ? "rounded-t-xl" : ""} ${i === suggestions.length - 1 ? "rounded-b-xl" : ""}`}
            >
              <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

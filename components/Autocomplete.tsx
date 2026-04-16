"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Props {
  column: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
}

export default function Autocomplete({ column, value, onChange, placeholder, className = "" }: Props) {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]   = useState(value);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [allValues, setAllValues]   = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef  = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/contacts/values?column=${encodeURIComponent(column)}`)
      .then((r) => r.json())
      .then((d) => { setAllValues(d.values || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [column]);

  const fuzzy = useCallback((text: string, pattern: string): number => {
    if (!pattern) return 1;
    const t = text.toLowerCase();
    const p = pattern.toLowerCase();
    if (t === p) return 100;
    if (t.startsWith(p)) return 80 + (p.length / t.length) * 20;
    if (t.includes(p)) return 50 + (p.length / t.length) * 30;
    let pi = 0, score = 0;
    for (let ti = 0; ti < t.length && pi < p.length; ti++) {
      if (t[ti] === p[pi]) { score += 2; pi++; }
    }
    if (pi === p.length) return Math.min(40, score);
    return score * 0.3;
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!query.trim()) {
        setSuggestions(allValues.slice(0, 50));
      } else {
        const scored = allValues
          .map((v) => ({ v, s: fuzzy(v, query) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 30)
          .map((x) => x.v);
        setSuggestions(scored);
      }
      setHighlight(0);
    }, 150);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, allValues, fuzzy]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.closest(".autocomplete-wrapper")?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(v: string) {
    onChange(v);
    setQuery(v);
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); setOpen(true); return; }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    if (e.key === "Enter")     { e.preventDefault(); if (suggestions[highlight]) handleSelect(suggestions[highlight]); }
    if (e.key === "Escape")   { e.preventDefault(); setOpen(false); inputRef.current?.blur(); }
  }

  const showDropdown = open && !loading && suggestions.length > 0;

  function highlightMatch(text: string): React.ReactNode {
    if (!query.trim()) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-yellow-200 text-yellow-900 font-medium rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    );
  }

  return (
    <div className={`autocomplete-wrapper relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => { const v = e.target.value; setQuery(v); onChange(v); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={loading ? "Loading..." : placeholder || "Type to search..."}
        className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 placeholder-gray-500"
        autoComplete="off"
        disabled={loading}
      />
      {showDropdown && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl max-h-64 overflow-y-auto"
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
              {i === 0 && suggestions.length > 1 && (
                <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded font-medium">Top</span>
              )}
              <span className="flex-1">{highlightMatch(s)}</span>
            </div>
          ))}
        </div>
      )}
      {!loading && !open && query && (
        <button
          type="button"
          onClick={() => { setQuery(""); onChange(""); setOpen(true); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

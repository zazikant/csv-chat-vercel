"use client";

import { useState, useEffect, useRef } from "react";

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  className?: string;
}

interface TagCount { tag: string; count: number }

/**
 * TagsInput - free-form chip input with smart suggestions.
 *
 * Fetches all distinct tags from /api/tags (with usage counts) and shows
 * a smart-suggestion dropdown as the user types. The bulb icon (matching
 * the FieldSuggest component pattern) toggles the suggestion list.
 *
 * Behavior:
 * - Type a tag, press Enter or comma to add it.
 * - Tags are normalized to lowercase + trimmed on add.
 * - Duplicate tags are silently dropped.
 * - Backspace on an empty input removes the last tag.
 * - Click the × on a chip to remove it.
 */
export default function TagsInput({ value, onChange, placeholder, className = "" }: Props) {
  const [input, setInput] = useState("");
  const [allTags, setAllTags] = useState<TagCount[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch all existing tags (for suggestions)
  useEffect(() => {
    fetch("/api/tags")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setAllTags(d as TagCount[]);
      })
      .catch(() => setAllTags([]));
  }, []);

  // Filtered suggestions: tags that start with the current input AND aren't already added
  const loweredInput = input.trim().toLowerCase();
  const suggestions = loweredInput
    ? allTags.filter((t) => t.tag.startsWith(loweredInput) && !value.includes(t.tag)).slice(0, 20)
    : allTags.filter((t) => !value.includes(t.tag)).slice(0, 20);

  function addTag(rawTag: string) {
    const tag = rawTag.trim().toLowerCase();
    if (!tag) return;
    if (value.includes(tag)) {
      setInput("");
      setShowDropdown(false);
      return;
    }
    onChange([...value, tag]);
    setInput("");
    setShowDropdown(false);
    setHighlight(0);
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (input.trim()) {
        if (showDropdown && suggestions.length > 0 && highlight < suggestions.length) {
          addTag(suggestions[highlight].tag);
        } else {
          addTag(input);
        }
      }
    } else if (e.key === "Backspace" && !input && value.length > 0) {
      e.preventDefault();
      removeTag(value[value.length - 1]);
    } else if (e.key === "ArrowDown" && showDropdown && suggestions.length > 0) {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp" && showDropdown && suggestions.length > 0) {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setShowDropdown(false);
    }
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const show = showDropdown && suggestions.length > 0;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <div className="flex items-center gap-1 flex-wrap min-h-[38px] px-2 py-1 border border-gray-200 rounded-lg focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-300 bg-white">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="hover:bg-blue-200 rounded-full w-4 h-4 flex items-center justify-center text-blue-500"
              aria-label={`Remove ${tag}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value); setShowDropdown(true); setHighlight(0); }}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowDropdown(true)}
          placeholder={value.length === 0 ? (placeholder || "Add tags...") : ""}
          className="flex-1 min-w-[80px] text-sm outline-none text-gray-700 placeholder-gray-500 bg-transparent"
        />
        <button
          type="button"
          onClick={() => { setShowDropdown((s) => !s); inputRef.current?.focus(); }}
          title="Show tag suggestions"
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
              key={s.tag}
              onMouseDown={(e) => { e.preventDefault(); addTag(s.tag); }}
              onMouseEnter={() => setHighlight(i)}
              className={`px-4 py-2.5 text-sm cursor-pointer flex items-center justify-between ${
                i === highlight ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-50"
              } ${i === 0 ? "rounded-t-xl" : ""} ${i === suggestions.length - 1 ? "rounded-b-xl" : ""}`}
            >
              <div className="flex items-center gap-2">
                <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                <span>{s.tag}</span>
              </div>
              <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                {s.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

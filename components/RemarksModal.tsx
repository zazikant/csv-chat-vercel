"use client";

import { useEffect } from "react";

interface Props {
  open: boolean;
  title: string;
  value: string | null | undefined;
  onClose: () => void;
}

/**
 * Full-screen / full-card modal for viewing long-form text fields
 * (remarks, location). Renders the content in a scrollable, monospace
 * block that's comfortable to read on both mobile (full viewport) and
 * desktop (centered card with max height). Supports Escape to close
 * and click-outside to close.
 *
 * Used by MainDatabaseTable when the user clicks the "Expand" button
 * on a truncated remarks/location cell.
 */
export default function RemarksModal({ open, title, value, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    // Lock body scroll while modal is open
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const text = value ?? "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col bg-white shadow-xl sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-2xl sm:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-gray-800">
              {title}
            </h3>
            <p className="text-[11px] text-gray-400">
              {text.length.toLocaleString()} characters
              {text.includes("\n") && ` · ${text.split("\n").length} lines`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50/50 p-4">
          {text ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-gray-700">
              {text}
            </pre>
          ) : (
            <p className="text-sm text-gray-400">No content.</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-gray-200 bg-white px-4 py-2.5">
          <button
            onClick={() => {
              navigator.clipboard?.writeText(text).catch(() => {});
            }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
              />
            </svg>
            Copy
          </button>
          <span className="text-[10px] text-gray-400">
            Press Esc to close
          </span>
        </div>
      </div>
    </div>
  );
}

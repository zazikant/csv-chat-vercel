"use client";

import { useState, useEffect } from "react";
import { MailerRow } from "@/lib/langgraph/state";

interface Props {
  record: MailerRow | null;
  mode: "add" | "edit";
  onClose: () => void;
  onSave: () => void;
}

export default function MailerEditModal({ record, mode, onClose, onSave }: Props) {
  const [form, setForm]   = useState<Partial<MailerRow>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setForm(mode === "edit" && record ? { ...record } : { mailer_id: "" });
    setError("");
  }, [record, mode]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function setVal(key: keyof MailerRow, value: string | number | null) {
    setForm((prev) => ({ ...prev, [key]: value ?? null }));
  }

  function isoToLocalInput(iso: string | null | undefined): string {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return "";
    }
  }

  function localInputToISO(local: string): string | null {
    if (!local) return null;
    try {
      const d = new Date(local);
      if (isNaN(d.getTime())) return null;
      return d.toISOString();
    } catch {
      return null;
    }
  }

  async function handleSave() {
    if (!form.mailer_id) {
      setError("Mailer ID is required (e.g. M001).");
      return;
    }
    if (!form.subject_line) {
      setError("Subject line is required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const url = "/api/mailers";
      const method = mode === "edit" ? "PUT" : "POST";
      const payload: Record<string, unknown> = { ...form };
      // Strip auto-maintained / generated fields
      for (const f of [
        "total_sent","unique_opens","total_opens","unique_clicks",
        "total_clicks","unsubscribed_count","hardbounced_count",
        "open_rate","click_rate","unsubscribe_rate","hardbounce_rate",
        "created_at","updated_at",
      ]) {
        delete payload[f];
      }
      if (mode === "edit") {
        payload.mailer_id = record!.mailer_id;
      }
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Save failed");
      }
      onSave();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this mailer? Contacts assigned to it will have their mailer_id cleared (not deleted). This cannot be undone.")) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch("/api/mailers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailer_id: record!.mailer_id }),
      });
      if (!res.ok) throw new Error("Delete failed");
      onSave();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  const section = (label: string, children: React.ReactNode) => (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 pb-1">{label}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">{children}</div>
    </div>
  );

  const field = (
    key: keyof MailerRow,
    label: string,
    type: "text" | "datetime-local",
    colSpan = false,
    placeholder?: string,
    disabled = false,
  ) => (
    <div key={key} className={colSpan ? "col-span-2" : ""}>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      <input
        type={type}
        value={type === "datetime-local"
          ? isoToLocalInput(form[key] as string)
          : (form[key] as string) || ""}
        disabled={disabled}
        onChange={(e) => setVal(key, type === "datetime-local" ? localInputToISO(e.target.value) : e.target.value)}
        className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 placeholder-gray-500 disabled:bg-gray-50 disabled:text-gray-400"
        placeholder={placeholder}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-2 sm:mx-auto max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800">
            {mode === "edit" ? "Edit Mailer" : "Add New Mailer"}
          </h2>
          <div className="flex items-center gap-3">
            {record?.mailer_id && (
              <span className="text-xs text-gray-400 font-mono">{record.mailer_id}</span>
            )}
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          {section("Mailer Details", <>
            {field("mailer_id", "Mailer ID *", "text", false, "e.g. M001", mode === "edit")}
            {field("template_name", "Template Name", "text", false, "e.g. Newsletter-Jan-2026")}
            {field("subject_line", "Subject Line *", "text", true, "e.g. Q1 Newsletter: What's new this January")}
            {field("sent_date", "Sent Date", "datetime-local")}
          </>)}

          {mode === "edit" && (
            <div className="px-4 py-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
              <strong>Performance metrics</strong> (auto-aggregated from the Contacts tab — every contact whose <code>mailer_id</code> matches this mailer contributes to these counters):
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div><span className="text-gray-500">Contacts (sent):</span> <strong>{record?.total_sent ?? 0}</strong></div>
                <div><span className="text-gray-500">Unique Opens:</span> <strong>{record?.unique_opens ?? 0}</strong></div>
                <div><span className="text-gray-500">Total Opens:</span> <strong>{record?.total_opens ?? 0}</strong></div>
                <div><span className="text-gray-500">Unique Clicks:</span> <strong>{record?.unique_clicks ?? 0}</strong></div>
                <div><span className="text-gray-500">Total Clicks:</span> <strong>{record?.total_clicks ?? 0}</strong></div>
                <div><span className="text-gray-500">Unsubscribed:</span> <strong>{record?.unsubscribed_count ?? 0}</strong></div>
                <div><span className="text-gray-500">Hard Bounced:</span> <strong>{record?.hardbounced_count ?? 0}</strong></div>
              </div>
              <div className="grid grid-cols-4 gap-2 mt-2 pt-2 border-t border-blue-100">
                <div><span className="text-gray-500">Open Rate:</span> <strong>{record?.open_rate != null ? `${Number(record.open_rate).toFixed(2)}%` : "—"}</strong></div>
                <div><span className="text-gray-500">Click Rate:</span> <strong>{record?.click_rate != null ? `${Number(record.click_rate).toFixed(2)}%` : "—"}</strong></div>
                <div><span className="text-gray-500">Unsub Rate:</span> <strong>{record?.unsubscribe_rate != null ? `${Number(record.unsubscribe_rate).toFixed(2)}%` : "—"}</strong></div>
                <div><span className="text-gray-500">Bounce Rate:</span> <strong>{record?.hardbounce_rate != null ? `${Number(record.hardbounce_rate).toFixed(2)}%` : "—"}</strong></div>
              </div>
              <div className="mt-2 text-gray-500">
                These numbers update automatically whenever you add, edit, or delete a contact in the Contacts tab.
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
          <div>
            {mode === "edit" && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete Mailer"}
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : mode === "edit" ? "Save Changes" : "Add Mailer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

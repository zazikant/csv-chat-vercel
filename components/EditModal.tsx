"use client";

import { useState, useEffect } from "react";
import { ContactRow } from "@/lib/langgraph/state";
import FieldSuggest from "./FieldSuggest";

interface Props {
  record: ContactRow | null;
  mode: "add" | "edit";
  onClose: () => void;
  onSave: () => void;
}

const OPTIN_STATUSES = ["Subscribed", "Hard Bounced", "Unsubscribed"];

interface MailerOption { mailer_id: string; subject_line: string }

export default function EditModal({ record, mode, onClose, onSave }: Props) {
  const [form, setForm]   = useState<Partial<ContactRow>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const [deleting, setDeleting] = useState(false);
  const [mailerOptions, setMailerOptions] = useState<MailerOption[]>([]);

  useEffect(() => {
    setForm(mode === "edit" && record
      ? { ...record, opens: record.opens ?? 0, clicks: record.clicks ?? 0 }
      : { opens: 0, clicks: 0, optin_status: "Subscribed" }
    );
    setError("");
  }, [record, mode]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Fetch mailer_id options for the autocomplete
  useEffect(() => {
    fetch("/api/mailers?values=1")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) setMailerOptions(d as MailerOption[]);
      })
      .catch(() => setMailerOptions([]));
  }, []);

  function setVal<T extends keyof ContactRow>(key: T, value: ContactRow[T]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // When user picks a different mailer, reset opens/clicks to defaults
  // (per the design: opens/clicks are per (contact, mailer))
  function handleMailerChange(mailerId: string) {
    const trimmed = mailerId.trim();
    const isSameAsForm = (form.mailer_id ?? "") === trimmed;
    setForm((prev) => ({
      ...prev,
      mailer_id: trimmed || null,
      // Only reset counters if the mailer actually changed
      ...(isSameAsForm ? {} : { opens: 0, clicks: 0 }),
    }));
  }

  async function handleSave() {
    if (!form.email) {
      setError("Email is required (it is the primary key).");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const url = "/api/contacts";
      const method = mode === "edit" ? "PUT" : "POST";
      // Strip auto-maintained fields before sending
      const payload: Record<string, unknown> = { ...form };
      for (const f of [
        "last_activity_date","engagement_score","created_at","updated_at",
      ]) {
        delete payload[f];
      }
      if (mode === "edit") {
        payload.email = record!.email; // PK is immutable on update
      }
      // Normalize empty mailer_id to null
      if (!payload.mailer_id) payload.mailer_id = null;
      // Server will lazily create the mailer if it doesn't exist (avoids FK error)
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
    if (!confirm("Delete this contact? This cannot be undone.")) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch("/api/contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: record!.email }),
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
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">{children}</div>
    </div>
  );

  const field = (
    key: keyof ContactRow,
    label: string,
    type: "text" | "email" | "number" | "date" | "textarea",
    colSpan = false,
    placeholder?: string,
    disabled = false,
  ) => (
    <div key={key} className={colSpan ? "col-span-2" : ""}>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      {type === "number" ? (
        <input
          type="number"
          min={0}
          value={(form[key] as number) ?? ""}
          disabled={disabled}
          onChange={(e) => setVal(key, (e.target.value ? Number(e.target.value) : 0) as never)}
          className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 placeholder-gray-500 disabled:bg-gray-50 disabled:text-gray-400"
          placeholder={placeholder}
        />
      ) : type === "email" ? (
        <input
          type="email"
          value={(form[key] as string) || ""}
          disabled={disabled}
          onChange={(e) => setVal(key, e.target.value as never)}
          className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 placeholder-gray-500 disabled:bg-gray-50 disabled:text-gray-400"
          placeholder={placeholder}
        />
      ) : type === "textarea" ? (
        <textarea
          value={(form[key] as string) || ""}
          disabled={disabled}
          onChange={(e) => setVal(key, e.target.value as never)}
          rows={3}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 resize-none placeholder-gray-500"
        />
      ) : (
        <FieldSuggest
          column={key}
          value={(form[key] as string) || ""}
          onChange={(v) => setVal(key, v as never)}
          placeholder={placeholder}
          className="w-full"
        />
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800">
            {mode === "edit" ? "Edit Contact" : "Add New Contact"}
          </h2>
          <div className="flex items-center gap-3">
            {record?.email && (
              <span className="text-xs text-gray-400 font-mono">{record.email}</span>
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

          {section("Identity", <>
            {field("email", "Email *", "email", false, "e.g. rajesh@company.com", mode === "edit")}
            {field("name", "Name", "text", false, "e.g. Rajesh Kumar")}
          </>)}

          {section("Organization", <>
            {field("company", "Company", "text", false, "e.g. Godrej Properties")}
            {field("designation", "Designation", "text", false, "e.g. Project Manager")}
            {field("city", "City", "text", false, "e.g. Mumbai")}
            {field("sector", "Sector", "text", false, "e.g. Real Estate")}
          </>)}

          {section("Contact", <>
            {field("phone", "Phone", "text", false, "e.g. +91 9876543210")}
            {/* Opt-in status as dropdown */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Opt-in Status</label>
              <select
                value={(form.optin_status as string) || "Subscribed"}
                onChange={(e) => setVal("optin_status", e.target.value as never)}
                className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 bg-white"
              >
                {OPTIN_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">
                Use <strong>Unsubscribed</strong> if the contact opted out.
                The Mailers tab will count them in unsubscribed_count.
              </p>
            </div>
          </>)}

          {section("Mailer Engagement (manual)", <>
            {/* Mailer ID autocomplete */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Mailer ID</label>
              <input
                type="text"
                list="mailer-options"
                value={(form.mailer_id as string) || ""}
                onChange={(e) => handleMailerChange(e.target.value)}
                placeholder="e.g. M001 (type or pick)"
                className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 placeholder-gray-500 font-mono"
              />
              <datalist id="mailer-options">
                {mailerOptions.map((m) => (
                  <option key={m.mailer_id} value={m.mailer_id}>
                    {m.subject_line}
                  </option>
                ))}
              </datalist>
              <p className="text-xs text-gray-400 mt-1">
                {mailerOptions.length > 0
                  ? `${mailerOptions.length} mailer${mailerOptions.length > 1 ? "s" : ""} available — typing a new ID will auto-create a stub mailer`
                  : "No mailers yet — typing a new ID will auto-create a stub mailer. You can fill in details later in the Mailers tab"}
              </p>
            </div>

            {field("opens", "Opens (count)", "number", false, "0", false)}
            {field("clicks", "Clicks (count)", "number", false, "0", false)}
          </>)}

          {mode === "edit" && (
            <div className="px-4 py-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
              <strong>Auto-maintained fields</strong> (read-only):
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div><span className="text-gray-500">Engagement:</span> {record?.engagement_score ?? "COLD"}</div>
                <div><span className="text-gray-500">Last activity:</span> {record?.last_activity_date ? new Date(record.last_activity_date).toLocaleString() : "—"}</div>
              </div>
              <div className="mt-2 text-gray-500">
                These update automatically when you save Opens / Clicks above. The assigned Mailer's counters in the Mailers tab also update automatically.
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
                {deleting ? "Deleting..." : "Delete Record"}
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
              {saving ? "Saving..." : mode === "edit" ? "Save Changes" : "Add Contact"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

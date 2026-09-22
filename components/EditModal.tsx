"use client";

import { useState, useEffect } from "react";
import { ContactRow } from "@/lib/langgraph/state";
import FieldSuggest from "./FieldSuggest";
import TagsInput from "./TagsInput";

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
  const [mailerDropdownOpen, setMailerDropdownOpen] = useState(false);
  const [mailerHighlight, setMailerHighlight] = useState(0);

  useEffect(() => {
    setForm(mode === "edit" && record
      ? { ...record, opens: record.opens ?? 0, clicks: record.clicks ?? 0, tags: record.tags ?? [] }
      : { opens: 0, clicks: 0, optin_status: "Subscribed", tags: [] }
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

  // Autofill name/company/designation/phone from the latest existing record
  // for this email. Only fires on Add mode (not Edit) and only fills fields
  // that are currently empty (so user-typed values take precedence).
  // This is helpful when uploading multiple mailer events for the same contact
  // — you only type the email, the rest gets filled in.
  const emailValue = (form.email as string || "").trim().toLowerCase();
  useEffect(() => {
    // Only auto-fill in "add" mode (in "edit" mode the form is already pre-filled)
    if (mode !== "add") return;
    // Need a non-empty, plausible email (must contain @)
    if (!emailValue || !emailValue.includes("@")) return;
    // Don't refetch on every keystroke — only when the email looks complete
    // (contains both @ and a dot after @)
    const atIdx = emailValue.indexOf("@");
    if (atIdx === -1) return;
    if (!emailValue.slice(atIdx + 1).includes(".")) return;

    let cancelled = false;
    fetch(`/api/contacts?email=eq.${encodeURIComponent(emailValue)}&select=name,company,designation,phone&limit=1`)
      .then((r) => r.ok ? r.json() : [])
      .then((rows) => {
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return;
        const existing = rows[0] as { name?: string | null; company?: string | null; designation?: string | null; phone?: string | null };
        setForm((prev) => ({
          ...prev,
          // Only fill fields that are currently empty/null
          name:         prev.name         || existing.name         || prev.name,
          company:      prev.company        || existing.company        || prev.company,
          designation:  prev.designation   || existing.designation   || prev.designation,
          phone:        prev.phone         || existing.phone         || prev.phone,
        }));
      })
      .catch(() => { /* silent — user is offline or endpoint errored */ });
    return () => { cancelled = true; };
  }, [emailValue, mode]);

  function setVal<T extends keyof ContactRow>(key: T, value: ContactRow[T]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleMailerChange(mailerId: string) {
    const trimmed = mailerId.trim();
    const isSameAsForm = (form.mailer_id ?? "") === trimmed;
    setForm((prev) => ({
      ...prev,
      mailer_id: trimmed || null,
      ...(isSameAsForm ? {} : { opens: 0, clicks: 0 }),
    }));
  }

  // Combobox-style mailer picker: filter options by what's typed
  const mailerInputValue = (form.mailer_id as string) || "";
  const loweredMailer = mailerInputValue.trim().toLowerCase();
  const filteredMailers = loweredMailer
    ? mailerOptions.filter((m) =>
        m.mailer_id.toLowerCase().includes(loweredMailer) ||
        m.subject_line.toLowerCase().includes(loweredMailer)
      )
    : mailerOptions;

  function handleMailerKeyDown(e: React.KeyboardEvent) {
    if (!mailerDropdownOpen || filteredMailers.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setMailerHighlight((h) => Math.min(h + 1, filteredMailers.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setMailerHighlight((h) => Math.max(h - 1, 0)); }
    if (e.key === "Enter")     {
      e.preventDefault();
      if (mailerHighlight < filteredMailers.length) {
        handleMailerChange(filteredMailers[mailerHighlight].mailer_id);
        setMailerDropdownOpen(false);
      }
    }
    if (e.key === "Escape") { e.preventDefault(); setMailerDropdownOpen(false); }
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
      const payload: Record<string, unknown> = { ...form };
      for (const f of [
        "id","last_activity_date","engagement_score","created_at","updated_at",
      ]) {
        delete payload[f];
      }
      if (mode === "edit") {
        payload.id = record!.id;  // use id for updates (email is no longer the PK)
      }
      // Normalize mailer_id: if empty/null, OMIT the field entirely so the
      // server merge logic can distinguish "user didn't fill this" (preserve
      // existing) from "user explicitly cleared it" (set to null).
      // We do this by deleting the key from the payload when it's empty.
      if (!payload.mailer_id) {
        delete payload.mailer_id;
      }
      // Ensure tags is always an array
      payload.tags = Array.isArray(payload.tags) ? payload.tags : [];
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
        body: JSON.stringify({ id: record!.id }),
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
                Use <strong>Hard Bounced</strong> if their email bounced.
                The Mailers tab derives unsubscribed_count and hardbounced_count from these values.
              </p>
            </div>
          </>)}

          {section("Tags", <>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Tags</label>
              <TagsInput
                value={Array.isArray(form.tags) ? form.tags : []}
                onChange={(tags) => setVal("tags", tags as never)}
                placeholder="e.g. vip, mumbai, contractor (press Enter to add)"
                className="w-full"
              />
              <p className="text-xs text-gray-400 mt-1">
                Categorize this contact with free-form tags. Click the 💡 bulb icon to see suggestions from tags you've already used elsewhere.
              </p>
            </div>
          </>)}

          {section("Mailer Engagement (manual)", <>
            {/* Mailer ID — combobox (dropdown + free typing) */}
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Mailer ID</label>
              <div className="relative">
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={mailerInputValue}
                    onChange={(e) => { handleMailerChange(e.target.value); setMailerDropdownOpen(true); setMailerHighlight(0); }}
                    onKeyDown={handleMailerKeyDown}
                    onFocus={() => setMailerDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setMailerDropdownOpen(false), 150)}
                    placeholder="e.g. M001 (type or pick from dropdown)"
                    className="flex-1 px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 placeholder-gray-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => { setMailerDropdownOpen((s) => !s); }}
                    title="Show mailer options"
                    className="flex-shrink-0 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <svg className={`w-3.5 h-3.5 transition-transform ${mailerDropdownOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
                {mailerDropdownOpen && filteredMailers.length > 0 && (
                  <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl max-h-52 overflow-y-auto">
                    {filteredMailers.map((m, i) => (
                      <div
                        key={m.mailer_id}
                        onMouseDown={(e) => { e.preventDefault(); handleMailerChange(m.mailer_id); setMailerDropdownOpen(false); }}
                        onMouseEnter={() => setMailerHighlight(i)}
                        className={`px-4 py-2.5 text-sm cursor-pointer flex items-center gap-3 ${
                          i === mailerHighlight ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-50"
                        } ${i === 0 ? "rounded-t-xl" : ""} ${i === filteredMailers.length - 1 ? "rounded-b-xl" : ""}`}
                      >
                        <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{m.mailer_id}</span>
                        <span className="truncate">{m.subject_line}</span>
                      </div>
                    ))}
                  </div>
                )}
                {mailerDropdownOpen && filteredMailers.length === 0 && mailerInputValue && (
                  <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl px-4 py-3 text-sm text-gray-500">
                    No mailers match <strong>&quot;{mailerInputValue}&quot;</strong>. Press Save to auto-create a stub mailer with this ID.
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {mailerOptions.length > 0
                  ? `${mailerOptions.length} mailer${mailerOptions.length > 1 ? "s" : ""} available. Click ▾ to pick, or type a new ID to auto-create.`
                  : "No mailers yet. Typing a new ID will auto-create a stub mailer. You can fill in details later in the Mailers tab."}
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

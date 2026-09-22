"use client";

import { useState, useEffect } from "react";
import { MainContactRow } from "@/lib/langgraph/state";
import FieldSuggest from "./FieldSuggest";
import TagsInput from "./TagsInput";

interface Props {
  record: MainContactRow | null;
  mode: "add" | "edit";
  onClose: () => void;
  onSave: () => void;
}

export default function MainEditModal({ record, mode, onClose, onSave }: Props) {
  const [form, setForm] = useState<Partial<MainContactRow>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setForm(mode === "edit" && record ? { ...record } : {});
    setError("");
  }, [record, mode]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function setVal<T extends keyof MainContactRow>(key: T, value: MainContactRow[T]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!form.email) { setError("Email is required."); return; }
    setSaving(true); setError("");
    try {
      const payload: Record<string, unknown> = { ...form };
      delete payload.created_at; delete payload.updated_at;
      if (mode === "edit") payload.email = record!.email;
      payload.tags = Array.isArray(payload.tags) ? payload.tags : [];
      const res = await fetch("/api/main-contacts", {
        method: mode === "edit" ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Save failed"); }
      onSave(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "Save failed"); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm("Delete this contact? This will also delete all their engagement rows.")) return;
    setDeleting(true); setError("");
    try {
      const res = await fetch("/api/main-contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: record!.email }),
      });
      if (!res.ok) throw new Error("Delete failed");
      onSave();
    } catch (err) { setError(err instanceof Error ? err.message : "Delete failed"); }
    finally { setDeleting(false); }
  }

  const section = (label: string, children: React.ReactNode) => (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100 pb-1">{label}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">{children}</div>
    </div>
  );
  const field = (key: keyof MainContactRow, label: string, type: "text" | "email", placeholder?: string, disabled = false) => (
    <div key={key}>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      {type === "email" ? (
        <input type="email" value={(form[key] as string) || ""} disabled={disabled} onChange={(e) => setVal(key, e.target.value as never)} className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 placeholder-gray-500 disabled:bg-gray-50 disabled:text-gray-400" placeholder={placeholder} />
      ) : (
        <FieldSuggest column={key} value={(form[key] as string) || ""} onChange={(v) => setVal(key, v as never)} placeholder={placeholder} className="w-full" />
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden mx-2 sm:mx-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800">{mode === "edit" ? "Edit Contact" : "Add New Contact"}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}
          {section("Identity", <>
            {field("email", "Email *", "email", "e.g. rajesh@company.com", mode === "edit")}
            {field("name", "Name", "text", "e.g. Rajesh Kumar")}
          </>)}
          {section("Organization", <>
            {field("company", "Company", "text", "e.g. Godrej Properties")}
            {field("designation", "Designation", "text", "e.g. Project Manager")}
            {field("city", "City", "text", "e.g. Mumbai")}
            {field("sector", "Sector", "text", "e.g. Real Estate")}
          </>)}
          {section("Contact", <>{field("phone", "Phone", "text", "e.g. +91 9876543210")}</>)}
          {section("Tags", <>
            <div className="col-span-1 sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Tags</label>
              <TagsInput value={Array.isArray(form.tags) ? form.tags : []} onChange={(tags) => setVal("tags", tags as never)} placeholder="e.g. vip, mumbai" className="w-full" />
            </div>
          </>)}
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
          <div>{mode === "edit" && <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">{deleting ? "Deleting..." : "Delete Record"}</button>}</div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50">{saving ? "Saving..." : mode === "edit" ? "Save Changes" : "Add Contact"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

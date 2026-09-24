"use client";

import { useState, useEffect } from "react";
import { ContactRow } from "@/lib/langgraph/state";

interface Props {
  record: ContactRow | null;
  mode: "add" | "edit";
  onClose: () => void;
  onSave: () => void;
}

const OPTIN_STATUSES = ["Subscribed", "Hard Bounced", "Unsubscribed"];

interface MailerOption { mailer_id: string; subject_line: string }

export default function EditModal({ record, mode, onClose, onSave }: Props) {
  const [form, setForm] = useState<Partial<ContactRow>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [mailerOptions, setMailerOptions] = useState<MailerOption[]>([]);

  useEffect(() => {
    setForm(mode === "edit" && record ? { ...record, opens: record.opens ?? 0, clicks: record.clicks ?? 0 } : { opens: 0, clicks: 0, optin_status: "Subscribed" });
    setError("");
  }, [record, mode]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    fetch("/api/mailers?values=1").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setMailerOptions(d as MailerOption[]); }).catch(() => {});
  }, []);

  function setVal<T extends keyof ContactRow>(key: T, value: ContactRow[T]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!form.email) { setError("Email is required."); return; }
    setSaving(true); setError("");
    try {
      const payload: Record<string, unknown> = { ...form };
      for (const f of ["id", "last_activity_date", "engagement_score", "created_at", "updated_at"]) delete payload[f];
      if (mode === "edit") payload.id = record!.id;
      if (!payload.mailer_id) delete payload.mailer_id;
      payload.opens = Number(payload.opens) || 0;
      payload.clicks = Number(payload.clicks) || 0;
      const res = await fetch("/api/contacts", {
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
    if (!confirm("Delete this engagement record?")) return;
    setDeleting(true); setError("");
    try {
      const res = await fetch("/api/contacts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: record!.id }) });
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden mx-2 sm:mx-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800">{mode === "edit" ? "Edit Engagement" : "Add Engagement"}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">{error}</div>}
          {section("Contact", <>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Email *</label>
              <input type="email" value={(form.email as string) || ""} disabled={mode === "edit"} onChange={(e) => setVal("email", e.target.value)} className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 placeholder-gray-500 disabled:bg-gray-50 disabled:text-gray-400" placeholder="e.g. rajesh@company.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Mailer ID</label>
              <input type="text" list="mailer-options" value={(form.mailer_id as string) || ""} onChange={(e) => setVal("mailer_id", e.target.value)} placeholder="e.g. M001" className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 placeholder-gray-500 font-mono" />
              <datalist id="mailer-options">{mailerOptions.map((m) => <option key={m.mailer_id} value={m.mailer_id}>{m.subject_line}</option>)}</datalist>
            </div>
          </>)}
          {section("Engagement", <>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Opens</label>
              <input type="number" min={0} value={(form.opens as number) ?? 0} onChange={(e) => setVal("opens", Number(e.target.value) || 0 as never)} className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Clicks</label>
              <input type="number" min={0} value={(form.clicks as number) ?? 0} onChange={(e) => setVal("clicks", Number(e.target.value) || 0 as never)} className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300" />
            </div>
          </>)}
          {section("Status", <>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5">Opt-in Status</label>
              <select value={(form.optin_status as string) || "Subscribed"} onChange={(e) => setVal("optin_status", e.target.value as never)} className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 bg-white">
                {OPTIN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </>)}
          {mode === "edit" && (
            <div className="px-4 py-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
              <strong>Auto-maintained:</strong> Engagement: {record?.engagement_score ?? "COLD"} | Last activity: {record?.last_activity_date ? new Date(record.last_activity_date).toLocaleString() : "—"}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
          <div>{mode === "edit" && <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">{deleting ? "Deleting..." : "Delete Record"}</button>}</div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50">{saving ? "Saving..." : mode === "edit" ? "Save Changes" : "Add Engagement"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

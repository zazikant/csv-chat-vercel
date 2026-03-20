"use client";

import { useState, useEffect } from "react";
import { ContactRow } from "@/lib/langgraph/state";

const FIELDS: { key: keyof ContactRow; label: string; type: string }[] = [
  { key: "proposal_number",        label: "Proposal Number",     type: "text" },
  { key: "project_name",           label: "Project Name",         type: "text" },
  { key: "name",                   label: "Contact Name",          type: "text" },
  { key: "email",                  label: "Email",                 type: "email" },
  { key: "phone_number",           label: "Phone",                 type: "text" },
  { key: "designation",            label: "Designation",           type: "text" },
  { key: "company_name",           label: "Company Name",          type: "text" },
  { key: "type_of_customer",       label: "Type of Customer",      type: "text" },
  { key: "existing_new_customer",  label: "Existing / New Customer",type: "select" },
  { key: "sector",                 label: "Sector",                type: "text" },
  { key: "city",                   label: "City",                  type: "text" },
  { key: "status",                 label: "Status",                type: "select" },
  { key: "department",             label: "Department",            type: "select" },
  { key: "go_no_go_decision",      label: "Go / No-Go Decision",   type: "select" },
  { key: "inbound_outbound",       label: "Inbound / Outbound",    type: "select" },
  { key: "proposal_enquiry_for",   label: "Proposal Enquiry For",   type: "text" },
  { key: "quotation_method",        label: "Quotation Method",       type: "select" },
  { key: "proposal_value_inr",     label: "Proposal Value (₹)",     type: "number" },
  { key: "enquiry_received_date",  label: "Enquiry Received Date", type: "date" },
  { key: "proposal_sent_date",     label: "Proposal Sent Date",    type: "date" },
  { key: "mode_of_submission",     label: "Mode of Submission",     type: "select" },
  { key: "remarks",                label: "Remarks",                type: "textarea" },
];

const SELECT_OPTIONS: Record<string, string[]> = {
  status: ["Open", "Won", "Loss", "Closed"],
  department: ["PMC", "QC", "Rebar", "Design Engineering", "Structural", "Electrical", "Mechanical", "Architectural"],
  go_no_go_decision: ["Approved", "Not Approved", "Pending"],
  inbound_outbound: ["Inbound", "Outbound"],
  existing_new_customer: ["Existing", "New"],
  quotation_method: ["Lump Sum", "Man-Months", "Per Day Fee", "Per Hour Fee", "Item Rate", "Turnkey"],
  mode_of_submission: ["Email", "Hard Copy", "Ariba Portal", "Courier", "Portal", "In Person"],
};

interface Props {
  record: ContactRow | null;
  mode: "add" | "edit";
  onClose: () => void;
  onSave: () => void;
}

export default function EditModal({ record, mode, onClose, onSave }: Props) {
  const [form, setForm] = useState<Partial<ContactRow>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setForm(mode === "edit" && record ? { ...record } : {});
    setError("");
  }, [record, mode]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function handleChange(key: keyof ContactRow, value: string) {
    setForm((prev) => ({ ...prev, [key]: value || null }));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const url = mode === "edit" ? "/api/contacts" : "/api/contacts";
      const method = mode === "edit" ? "PUT" : "POST";
      const body = mode === "edit"
        ? { id: record!.id, ...form }
        : form;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
    if (!confirm("Delete this record? This cannot be undone.")) return;
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
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">
            {mode === "edit" ? "Edit Record" : "Add New Record"}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {FIELDS.map((field) => (
              <div key={field.key} className={field.type === "textarea" ? "col-span-2" : ""}>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  {field.label}
                </label>
                {field.type === "textarea" ? (
                  <textarea
                    value={(form[field.key] as string) || ""}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 resize-none"
                  />
                ) : field.type === "select" ? (
                  <select
                    value={(form[field.key] as string) || ""}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 bg-white"
                  >
                    <option value="">— select —</option>
                    {(SELECT_OPTIONS[field.key] || []).map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type}
                    value={(form[field.key] as string | number) || ""}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
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
              {saving ? "Saving..." : mode === "edit" ? "Save Changes" : "Add Record"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

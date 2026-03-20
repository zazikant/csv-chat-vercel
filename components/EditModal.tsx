"use client";

import { useState, useEffect } from "react";
import { ContactRow } from "@/lib/langgraph/state";
import Autocomplete from "./Autocomplete";

interface Props {
  record: ContactRow | null;
  mode: "add" | "edit";
  onClose: () => void;
  onSave: () => void;
}

export default function EditModal({ record, mode, onClose, onSave }: Props) {
  const [form, setForm]   = useState<Partial<ContactRow>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
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

  function setVal(key: keyof ContactRow, value: string | number | null) {
    setForm((prev) => ({ ...prev, [key]: value ?? null }));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const url = mode === "edit" ? "/api/contacts" : "/api/contacts";
      const method = mode === "edit" ? "PUT" : "POST";
      const body = mode === "edit" ? { id: record!.id, ...form } : form;

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
    type: "text" | "email" | "number" | "date" | "autocomplete" | "textarea",
    colSpan = false,
    placeholder?: string
  ) => (
    <div key={key} className={colSpan ? "col-span-2" : ""}>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">{label}</label>
      {type === "autocomplete" ? (
        <Autocomplete
          column={key}
          value={(form[key] as string) || ""}
          onChange={(v) => setVal(key, v)}
          className="w-full"
        />
      ) : type === "number" ? (
        <input
          type="number"
          value={(form[key] as number) ?? ""}
          onChange={(e) => setVal(key, e.target.value ? Number(e.target.value) : null)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
          placeholder={placeholder}
        />
      ) : type === "textarea" ? (
        <textarea
          value={(form[key] as string) || ""}
          onChange={(e) => setVal(key, e.target.value)}
          rows={3}
          placeholder={placeholder}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 resize-none"
        />
      ) : (
        <input
          type={type}
          value={(form[key] as string) || ""}
          onChange={(e) => setVal(key, e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300"
          placeholder={placeholder}
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
            {mode === "edit" ? "Edit Record" : "Add New Record"}
          </h2>
          <div className="flex items-center gap-3">
            {record?.proposal_number && (
              <span className="text-xs text-gray-400 font-mono">{record.proposal_number}</span>
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

          {section("Proposal Details", <>
            {field("proposal_number", "Proposal Number", "text", false, "e.g. GEM/2024/001")}
            {field("project_name", "Project Name", "text", false, "e.g. Mumbai Metro Phase 2")}
            {field("proposal_enquiry_for", "Proposal Enquiry For", "text", false, "e.g. Project Management Consultancy")}
            {field("proposal_value_inr", "Proposal Value (₹)", "number", false, "e.g. 5000000")}
            {field("quotation_method", "Quotation Method", "autocomplete")}
            {field("department", "Department", "autocomplete")}
            {field("status", "Status", "autocomplete")}
            {field("go_no_go_decision", "Go / No-Go Decision", "autocomplete")}
          </>)}

          {section("Customer & Project", <>
            {field("company_name", "Company Name", "text", true, "e.g. Godrej Properties")}
            {field("type_of_customer", "Type of Customer", "text", false, "e.g. Contractor")}
            {field("existing_new_customer", "Existing / New Customer", "autocomplete")}
            {field("sector", "Sector", "text", false, "e.g. Real Estate")}
            {field("inbound_outbound", "Inbound / Outbound", "autocomplete")}
          </>)}

          {section("Contact", <>
            {field("name", "Contact Name", "text", false, "e.g. Rajesh Kumar")}
            {field("designation", "Designation", "text", false, "e.g. Project Manager")}
            {field("email", "Email", "email", false, "e.g. rajesh@company.com")}
            {field("phone_number", "Phone", "text", false, "e.g. +91 9876543210")}
            {field("city", "City", "text", false, "e.g. Mumbai")}
          </>)}

          {section("Timeline & Submission", <>
            {field("enquiry_received_date", "Enquiry Received Date", "date")}
            {field("proposal_sent_date", "Proposal Sent Date", "date")}
            {field("mode_of_submission", "Mode of Submission", "autocomplete")}
          </>)}

          {section("Notes", <>
            {field("remarks", "Remarks", "textarea", true, "Add notes or latest update...")}
          </>)}
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
              {saving ? "Saving..." : mode === "edit" ? "Save Changes" : "Add Record"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

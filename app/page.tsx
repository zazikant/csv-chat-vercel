"use client";

import { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import ContactsTable from "@/components/ContactsTable";
import MailersTable from "@/components/MailersTable";
import ChatPanel from "@/components/ChatPanel";
import EditModal from "@/components/EditModal";
import MailerEditModal from "@/components/MailerEditModal";
import CSVUploadModal from "@/components/CSVUploadModal";
import { ContactRow, MailerRow } from "@/lib/langgraph/state";

type TabKey = "contacts" | "mailers";

async function fetchAllContacts(): Promise<ContactRow[]> {
  const res = await fetch("/api/contacts");
  if (!res.ok) return [];
  return res.json();
}

async function fetchAllMailers(): Promise<MailerRow[]> {
  const res = await fetch("/api/mailers");
  if (!res.ok) return [];
  return res.json();
}

export default function HomePage() {
  const [sessionId]         = useState(() => uuidv4());
  const [tab, setTab]       = useState<TabKey>("contacts");

  // Contacts state
  const [rows, setRows]         = useState<ContactRow[]>([]);
  const [allRows, setAllRows]   = useState<ContactRow[]>([]);
  const [isFiltered, setFiltered] = useState(false);
  const [contactPage, setContactPage] = useState(1);

  // Mailers state
  const [mailers, setMailers] = useState<MailerRow[]>([]);
  const [mailerPage, setMailerPage] = useState(1);

  // Modals
  const [editRecord, setEditRecord] = useState<ContactRow | null>(null);
  const [editMode, setEditMode]     = useState<"add" | "edit">("edit");
  const [mailerRecord, setMailerRecord] = useState<MailerRow | null>(null);
  const [mailerMode, setMailerMode]     = useState<"add" | "edit">("edit");
  const [showUpload, setShowUpload] = useState(false);

  // ---------- Contacts handlers ----------
  async function handleDeleteRows(emails: string[]) {
    await fetch("/api/contacts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails }),
    });
    reloadContacts();
  }

  function handleTableUpdate(newRows: ContactRow[]) {
    setRows(newRows);
    setFiltered(true);
    setContactPage(1);
  }

  function handleReset() {
    setRows(allRows);
    setFiltered(false);
    setContactPage(1);
  }

  function handleEdit(row: ContactRow) {
    setEditRecord(row);
    setEditMode("edit");
  }

  function handleAdd() {
    setEditRecord(null);
    setEditMode("add");
  }

  function handleModalClose() {
    setEditRecord(null);
    setEditMode("edit");
  }

  function reloadContacts() {
    fetchAllContacts().then((data) => {
      setRows(data);
      setAllRows(data);
      setFiltered(false);
      setContactPage(1);
    });
  }

  // ---------- Mailers handlers ----------
  async function handleDeleteMailers(ids: string[]) {
    await fetch("/api/mailers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mailer_ids: ids }),
    });
    reloadMailers();
  }

  function reloadMailers() {
    fetchAllMailers().then(setMailers);
  }

  function handleEditMailer(row: MailerRow) {
    setMailerRecord(row);
    setMailerMode("edit");
  }

  function handleAddMailer() {
    setMailerRecord(null);
    setMailerMode("add");
  }

  function handleMailerModalClose() {
    setMailerRecord(null);
    setMailerMode("edit");
  }

  // ---------- Initial load ----------
  useEffect(() => {
    reloadContacts();
    reloadMailers();
  }, []);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <div className="flex-1 flex flex-col border-r border-gray-200 min-w-0 overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center gap-1 px-4 pt-3 bg-white border-b border-gray-200">
          <TabButton
            label="Contacts"
            count={allRows.length}
            active={tab === "contacts"}
            onClick={() => setTab("contacts")}
          />
          <TabButton
            label="Mailers"
            count={mailers.length}
            active={tab === "mailers"}
            onClick={() => setTab("mailers")}
          />
        </div>

        {/* Tab body */}
        <div className="flex-1 overflow-hidden">
          {tab === "contacts" ? (
            <ContactsTable
              rows={rows}
              isFiltered={isFiltered}
              page={contactPage}
              onPageChange={setContactPage}
              onReset={handleReset}
              onEdit={handleEdit}
              onAdd={handleAdd}
              onUpload={() => setShowUpload(true)}
              onDeleteRows={handleDeleteRows}
            />
          ) : (
            <MailersTable
              rows={mailers}
              page={mailerPage}
              onPageChange={setMailerPage}
              onEdit={handleEditMailer}
              onAdd={handleAddMailer}
              onDeleteRows={handleDeleteMailers}
            />
          )}
        </div>
      </div>

      <div className="w-[400px] flex-shrink-0 flex flex-col overflow-hidden shadow-lg">
        <ChatPanel
          sessionId={sessionId}
          currentRows={rows}
          onTableUpdate={handleTableUpdate}
        />
      </div>

      {tab === "contacts" && (editRecord !== null || editMode === "add") && (
        <EditModal
          record={editRecord}
          mode={editMode}
          onClose={handleModalClose}
          onSave={reloadContacts}
        />
      )}

      {tab === "mailers" && (mailerRecord !== null || mailerMode === "add") && (
        <MailerEditModal
          record={mailerRecord}
          mode={mailerMode}
          onClose={handleMailerModalClose}
          onSave={reloadMailers}
        />
      )}

      {showUpload ? (
        <CSVUploadModal
          onClose={() => setShowUpload(false)}
          onUpload={() => {
            setShowUpload(false);
            reloadContacts();
          }}
        />
      ) : null}
    </div>
  );
}

function TabButton({
  label, count, active, onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
        active
          ? "border-blue-600 text-blue-600"
          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
      }`}
    >
      {label}
      <span
        className={`text-xs px-2 py-0.5 rounded-full ${
          active
            ? "bg-blue-100 text-blue-600"
            : "bg-gray-100 text-gray-500"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

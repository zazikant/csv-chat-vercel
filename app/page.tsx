"use client";

import { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import ContactsTable from "@/components/ContactsTable";
import MailersTable from "@/components/MailersTable";
import ChatPanel from "@/components/ChatPanel";
import EditModal from "@/components/EditModal";
import MailerEditModal from "@/components/MailerEditModal";
import CSVUploadModal from "@/components/CSVUploadModal";
import BulkDeleteModal from "@/components/BulkDeleteModal";
import SqlQueryBox from "@/components/SqlQueryBox";
import { ContactRow, MailerRow } from "@/lib/langgraph/state";

type TabKey = "contacts" | "mailers";
type MobileView = "table" | "chat";

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
  // On narrow screens, only one of (table, chat) is shown at a time.
  // On wide screens (md+), both are shown side-by-side and mobileView is ignored.
  const [mobileView, setMobileView] = useState<MobileView>("table");

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
  const [showBulkDelete, setShowBulkDelete] = useState(false);

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

  /** Receive rows from the SQL Query Box (paste-your-own SQL flow).
   *  The result replaces whatever table is currently active (Contacts or Mailers).
   *  We mark the view as "filtered" so the user can hit "Show all" to reset.
   */
  function handleSqlResult(rows: Record<string, unknown>[]) {
    if (tab === "contacts") {
      setRows(rows as unknown as ContactRow[]);
      setFiltered(true);
      setContactPage(1);
    } else {
      setMailers(rows as unknown as MailerRow[]);
    }
    setMailerPage(1);
    // Switch to table view on mobile so the user sees the result
    setMobileView("table");
  }

  function handleReset() {
    setRows(allRows);
    setFiltered(false);
    setContactPage(1);
  }

  /** Reset Mailers view back to the full list (after a SQL query replaced it). */
  function handleResetMailers() {
    reloadMailers();
    setMailerPage(1);
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

  /**
   * Bulk-delete contacts by email. Fetches existing emails first so we can
   * report how many were actually deleted vs how many weren't found (already
   * deleted previously). Used by the BulkDeleteModal on the Contacts tab.
   */
  async function handleBulkDeleteContacts(emails: string[]): Promise<{ deleted: number; notFound: string[] }> {
    // Fetch existing contacts to determine which emails actually exist
    const uniqueEmails = Array.from(new Set(emails));
    const res = await fetch("/api/contacts");
    const allContacts: ContactRow[] = res.ok ? await res.json() : [];
    const existingEmails = new Set(allContacts.map((c) => c.email));
    const toDelete = uniqueEmails.filter((e) => existingEmails.has(e));
    const notFound = uniqueEmails.filter((e) => !existingEmails.has(e));

    if (toDelete.length > 0) {
      await fetch("/api/contacts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: toDelete }),
      });
      reloadContacts();
    }
    return { deleted: toDelete.length, notFound };
  }

  /**
   * Bulk-delete mailers by mailer_id. Same pattern as contacts — fetch
   * existing first, delete the ones that match, report not-found.
   */
  async function handleBulkDeleteMailers(mailerIds: string[]): Promise<{ deleted: number; notFound: string[] }> {
    const uniqueIds = Array.from(new Set(mailerIds));
    const res = await fetch("/api/mailers");
    const allMailers: MailerRow[] = res.ok ? await res.json() : [];
    const existingIds = new Set(allMailers.map((m) => m.mailer_id));
    const toDelete = uniqueIds.filter((id) => existingIds.has(id));
    const notFound = uniqueIds.filter((id) => !existingIds.has(id));

    if (toDelete.length > 0) {
      await fetch("/api/mailers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailer_ids: toDelete }),
      });
      reloadMailers();
    }
    return { deleted: toDelete.length, notFound };
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
      {/* Main table area — full-width on mobile, flex-1 on md+ */}
      <div className={`flex-1 flex flex-col border-r border-gray-200 min-w-0 overflow-hidden ${
        mobileView === "chat" ? "hidden md:flex" : "flex"
      }`}>
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
          {/* Mobile-only: chat toggle button */}
          <button
            onClick={() => setMobileView("chat")}
            className="ml-auto md:hidden flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            title="Open chat"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            Chat
          </button>
        </div>

        {/* SQL Query Box — paste-your-own SQL (visible on both tabs) */}
        <SqlQueryBox onRun={handleSqlResult} />

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
              onBulkDelete={() => setShowBulkDelete(true)}
              onDeleteRows={handleDeleteRows}
            />
          ) : (
            <MailersTable
              rows={mailers}
              page={mailerPage}
              onPageChange={setMailerPage}
              onReset={handleResetMailers}
              onEdit={handleEditMailer}
              onAdd={handleAddMailer}
              onBulkDelete={() => setShowBulkDelete(true)}
              onDeleteRows={handleDeleteMailers}
            />
          )}
        </div>
      </div>

      {/* Chat panel — fixed width on md+, full-width overlay on mobile */}
      <div className={`flex flex-col overflow-hidden shadow-lg ${
        mobileView === "chat"
          ? "flex w-full md:w-[400px] md:flex-shrink-0"
          : "hidden md:flex md:w-[400px] md:flex-shrink-0"
      }`}>
        {/* Mobile-only: back button in chat header */}
        <div className="md:hidden flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
          <button
            onClick={() => setMobileView("table")}
            className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to table
          </button>
          <span className="text-xs text-gray-400 font-medium">AI Chat</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <ChatPanel
            sessionId={sessionId}
            currentRows={rows}
            onTableUpdate={handleTableUpdate}
          />
        </div>
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

      {showBulkDelete ? (
        <BulkDeleteModal
          entityName={tab === "contacts" ? "Contacts" : "Mailers"}
          pkFieldName={tab === "contacts" ? "email" : "mailer_id"}
          pkLabel={tab === "contacts" ? "Email" : "Mailer ID"}
          pkAliases={tab === "contacts" ? [] : ["mailer"]}
          onClose={() => setShowBulkDelete(false)}
          onDelete={tab === "contacts" ? handleBulkDeleteContacts : handleBulkDeleteMailers}
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

"use client";

import { Suspense, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import MainDatabaseTable from "@/components/MainDatabaseTable";
import ContactsTable from "@/components/ContactsTable";
import MailersTable from "@/components/MailersTable";
import ChatPanel from "@/components/ChatPanel";
import EditModal from "@/components/EditModal";
import MainEditModal from "@/components/MainEditModal";
import MailerEditModal from "@/components/MailerEditModal";
import CSVUploadModal from "@/components/CSVUploadModal";
import BulkDeleteModal from "@/components/BulkDeleteModal";
import SqlQueryBox from "@/components/SqlQueryBox";
import { MainContactRow, ContactRow, MailerRow } from "@/lib/langgraph/state";

type TabKey = "main" | "contacts" | "mailers";
type MobileView = "table" | "chat";

async function fetchAllMailers(): Promise<MailerRow[]> {
  const res = await fetch("/api/mailers");
  if (!res.ok) return [];
  return res.json();
}

export default function HomePage() {
  return (
    <Suspense fallback={<FullScreenLoading />}>
      <HomePageInner />
    </Suspense>
  );
}

function FullScreenLoading() {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-50 text-sm text-gray-400">
      Loading…
    </div>
  );
}

function HomePageInner() {
  const [sessionId] = useState(() => uuidv4());
  const [tab, setTab] = useState<TabKey>("main");
  const [mobileView, setMobileView] = useState<MobileView>("table");

  // Main contacts: page state lives here; the table fetches its own page
  // when `mainRowsOverride` is undefined (the new server-paged path).
  const [mainPage, setMainPage] = useState(1);
  // When non-null, the table renders these rows instead of fetching its own
  // page (used by SQL chat results and the "Show all" reset button).
  const [mainRowsOverride, setMainRowsOverride] = useState<MainContactRow[] | null>(null);
  const [mainTotalOverride, setMainTotalOverride] = useState<number | null>(null);
  const [totalMailsSent, setTotalMailsSent] = useState<Map<string, number>>(new Map());

  // Contacts (engagement) — small table (266 rows), keep client-side.
  const [contactRows, setContactRows] = useState<ContactRow[]>([]);
  const [contactPage, setContactPage] = useState(1);

  // Mailers
  const [mailers, setMailers] = useState<MailerRow[]>([]);
  const [mailerPage, setMailerPage] = useState(1);

  // Modals
  const [mainEditRecord, setMainEditRecord] = useState<MainContactRow | null>(null);
  const [mainEditMode, setMainEditMode] = useState<"add" | "edit">("edit");
  const [editRecord, setEditRecord] = useState<ContactRow | null>(null);
  const [editMode, setEditMode] = useState<"add" | "edit">("edit");
  const [mailerRecord, setMailerRecord] = useState<MailerRow | null>(null);
  const [mailerMode, setMailerMode] = useState<"add" | "edit">("edit");
  const [showUpload, setShowUpload] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);

  // Fetch mail-counts ONCE on mount (not per-page). Drives the "Total Mails
  // Sent" column on every page without re-aggregating per row.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/main-contacts/mail-counts")
      .then((r) => (r.ok ? r.json() : {}))
      .then((counts: Record<string, number>) => {
        if (cancelled) return;
        setTotalMailsSent(new Map(Object.entries(counts)));
      })
      .catch(() => { /* non-fatal — column just shows 0 */ });
    return () => { cancelled = true; };
  }, []);

  async function reloadAllContacts() {
    try {
      const res = await fetch("/api/contacts");
      if (res.ok) setContactRows(await res.json());
    } catch { /* non-fatal */ }
  }
  function reloadContacts() {
    // Defer state-setter to next microtask so it's not synchronously invoked
    // from a useEffect body (React 19 / Next 16 strict rule).
    queueMicrotask(() => { void reloadAllContacts(); });
  }
  function reloadMailers() { fetchAllMailers().then(setMailers); }
  function reloadMailCounts() {
    fetch("/api/main-contacts/mail-counts")
      .then((r) => (r.ok ? r.json() : {}))
      .then((counts: Record<string, number>) => setTotalMailsSent(new Map(Object.entries(counts))))
      .catch(() => {});
  }

  useEffect(() => {
    queueMicrotask(() => {
      void reloadAllContacts();
      reloadMailers();
    });
  }, []);

  // Main Database handlers
  async function handleDeleteMainRows(emails: string[]) {
    await fetch("/api/main-contacts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emails }) });
    setMainRowsOverride(null);
    setMainTotalOverride(null);
    reloadAllContacts();
    reloadMailCounts();
  }
  async function handleBulkDeleteMain(emails: string[]): Promise<{ deleted: number; notFound: string[] }> {
    const unique = Array.from(new Set(emails.map((e) => e.toLowerCase())));
    // We don't know the existing emails in server-paged mode without a fetch.
    // Just delete optimistically — the API will report the actual count.
    const notFound: string[] = [];
    if (unique.length > 0) {
      await fetch("/api/main-contacts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emails: unique }) });
    }
    setMainRowsOverride(null);
    setMainTotalOverride(null);
    reloadAllContacts();
    reloadMailCounts();
    return { deleted: unique.length, notFound };
  }

  // Contacts handlers
  async function handleDeleteRows(ids: string[]) {
    await fetch("/api/contacts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    reloadContacts();
  }
  async function handleBulkDeleteContacts(emails: string[]): Promise<{ deleted: number; notFound: string[] }> {
    const unique = Array.from(new Set(emails.map((e) => e.toLowerCase())));
    const existingEmails = new Set(contactRows.map((r) => r.email.toLowerCase()));
    const toDelete = unique.filter((e) => existingEmails.has(e));
    const notFound = unique.filter((e) => !existingEmails.has(e));
    if (toDelete.length > 0) {
      const ids = contactRows.filter((r) => toDelete.includes(r.email.toLowerCase())).map((r) => r.id);
      if (ids.length > 0) {
        await fetch("/api/contacts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
        reloadContacts();
      }
    }
    return { deleted: toDelete.length, notFound };
  }

  // Mailers handlers
  async function handleDeleteMailers(ids: string[]) {
    await fetch("/api/mailers", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mailer_ids: ids }) });
    reloadMailers();
  }
  async function handleBulkDeleteMailers(mailerIds: string[]): Promise<{ deleted: number; notFound: string[] }> {
    const unique = Array.from(new Set(mailerIds));
    const existing = new Set(mailers.map((m) => m.mailer_id));
    const toDelete = unique.filter((id) => existing.has(id));
    const notFound = unique.filter((id) => !existing.has(id));
    if (toDelete.length > 0) {
      await fetch("/api/mailers", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mailer_ids: toDelete }) });
      reloadMailers();
    }
    return { deleted: toDelete.length, notFound };
  }

  function handleSqlResult(rows: Record<string, unknown>[]) {
    if (tab === "main") {
      setMainRowsOverride(rows as unknown as MainContactRow[]);
      setMainTotalOverride(rows.length);
      setMainPage(1);
    }
    else if (tab === "contacts") { setContactRows(rows as unknown as ContactRow[]); setContactPage(1); }
    else { setMailers(rows as unknown as MailerRow[]); setMailerPage(1); }
    setMobileView("table");
  }

  /** When the chat returns query results, update the active tab's table. */
  function handleChatTableUpdate(rows: Record<string, unknown>[]) {
    if (tab === "main") {
      setMainRowsOverride(rows as unknown as MainContactRow[]);
      setMainTotalOverride(rows.length);
      setMainPage(1);
    }
    else if (tab === "contacts") { setContactRows(rows as unknown as ContactRow[]); setContactPage(1); }
    else { setMailers(rows as unknown as MailerRow[]); setMailerPage(1); }
    setMobileView("table");
  }

  function handleMainReset() {
    setMainRowsOverride(null);
    setMainTotalOverride(null);
    setMainPage(1);
  }

  // Counts shown on tab buttons
  const mainCount = mainRowsOverride ? mainRowsOverride.length : null; // null = "server will show"
  const contactCount = contactRows.length;
  const mailerCount = mailers.length;

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <div className={`flex-1 flex flex-col border-r border-gray-200 min-w-0 overflow-hidden ${mobileView === "chat" ? "hidden md:flex" : "flex"}`}>
        <div className="flex items-center gap-1 px-2 sm:px-4 pt-3 bg-white border-b border-gray-200 overflow-x-auto whitespace-nowrap flex-shrink-0">
          <TabButton label="Main Database" count={mainCount} active={tab === "main"} onClick={() => setTab("main")} />
          <TabButton label="Contacts" count={contactCount} active={tab === "contacts"} onClick={() => setTab("contacts")} />
          <TabButton label="Mailers" count={mailerCount} active={tab === "mailers"} onClick={() => setTab("mailers")} />
          <button onClick={() => setMobileView("chat")} className="ml-auto flex-shrink-0 md:hidden flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            Chat
          </button>
        </div>

        <SqlQueryBox onRun={handleSqlResult} />

        <div className="flex-1 overflow-hidden">
          {tab === "main" ? (
            <MainDatabaseTable
              rows={mainRowsOverride ?? undefined}
              total={mainTotalOverride ?? undefined}
              totalMailsSent={totalMailsSent}
              page={mainPage}
              onPageChange={setMainPage}
              onReset={mainRowsOverride ? handleMainReset : undefined}
              onEdit={(r) => { setMainEditRecord(r); setMainEditMode("edit"); }}
              onAdd={() => { setMainEditRecord(null); setMainEditMode("add"); }}
              onUpload={() => setShowUpload(true)}
              onBulkDelete={() => setShowBulkDelete(true)}
              onDeleteRows={handleDeleteMainRows}
            />
          ) : tab === "contacts" ? (
            <ContactsTable
              rows={contactRows}
              page={contactPage}
              onPageChange={setContactPage}
              onReset={reloadContacts}
              onEdit={(r) => { setEditRecord(r); setEditMode("edit"); }}
              onAdd={() => { setEditRecord(null); setEditMode("add"); }}
              onUpload={() => setShowUpload(true)}
              onBulkDelete={() => setShowBulkDelete(true)}
              onDeleteRows={handleDeleteRows}
            />
          ) : (
            <MailersTable
              rows={mailers}
              page={mailerPage}
              onPageChange={setMailerPage}
              onReset={reloadMailers}
              onEdit={(r) => { setMailerRecord(r); setMailerMode("edit"); }}
              onAdd={() => { setMailerRecord(null); setMailerMode("add"); }}
              onBulkDelete={() => setShowBulkDelete(true)}
              onDeleteRows={handleDeleteMailers}
            />
          )}
        </div>
      </div>

      <div className={`flex flex-col overflow-hidden shadow-lg ${mobileView === "chat" ? "flex w-full md:w-[400px] md:flex-shrink-0" : "hidden md:flex md:w-[400px] md:flex-shrink-0"}`}>
        <div className="md:hidden flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
          <button onClick={() => setMobileView("table")} className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            Back to table
          </button>
          <span className="text-xs text-gray-400 font-medium">AI Chat</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <ChatPanel sessionId={sessionId} currentRows={[]} onTableUpdate={handleChatTableUpdate} activeTab={tab} />
        </div>
      </div>

      {tab === "main" && (mainEditRecord !== null || mainEditMode === "add") && (
        <MainEditModal record={mainEditRecord} mode={mainEditMode} onClose={() => { setMainEditRecord(null); setMainEditMode("edit"); }} onSave={() => { handleMainReset(); reloadMailCounts(); reloadAllContacts(); }} />
      )}
      {tab === "contacts" && (editRecord !== null || editMode === "add") && (
        <EditModal record={editRecord} mode={editMode} onClose={() => { setEditRecord(null); setEditMode("edit"); }} onSave={reloadContacts} />
      )}
      {tab === "mailers" && (mailerRecord !== null || mailerMode === "add") && (
        <MailerEditModal record={mailerRecord} mode={mailerMode} onClose={() => { setMailerRecord(null); setMailerMode("edit"); }} onSave={reloadMailers} />
      )}

      {showUpload && (
        <CSVUploadModal onClose={() => setShowUpload(false)} onUpload={() => { setShowUpload(false); handleMainReset(); reloadAllContacts(); reloadMailCounts(); }} tab={tab} />
      )}
      {showBulkDelete && (
        <BulkDeleteModal
          entityName={tab === "mailers" ? "Mailers" : tab === "main" ? "Main Database" : "Contacts"}
          pkFieldName={tab === "mailers" ? "mailer_id" : "email"}
          pkLabel={tab === "mailers" ? "Mailer ID" : "Email"}
          pkAliases={tab === "mailers" ? ["mailer"] : []}
          onClose={() => setShowBulkDelete(false)}
          onDelete={tab === "mailers" ? handleBulkDeleteMailers : tab === "main" ? handleBulkDeleteMain : handleBulkDeleteContacts}
        />
      )}
    </div>
  );
}

function TabButton({ label, count, active, onClick }: { label: string; count: number | null; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${active ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"}`}>
      {label}
      <span className={`text-xs px-2 py-0.5 rounded-full ${active ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500"}`}>{count ?? "…"}</span>
    </button>
  );
}

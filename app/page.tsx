"use client";

import { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import ContactsTable from "@/components/ContactsTable";
import ChatPanel from "@/components/ChatPanel";
import EditModal from "@/components/EditModal";
import CSVUploadModal from "@/components/CSVUploadModal";
import { ContactRow } from "@/lib/langgraph/state";

async function fetchAllContacts(): Promise<ContactRow[]> {
  const res = await fetch("/api/contacts");
  if (!res.ok) return [];
  return res.json();
}

export default function HomePage() {
  const [sessionId]         = useState(() => uuidv4());
  const [rows, setRows]     = useState<ContactRow[]>([]);
  const [allRows, setAllRows] = useState<ContactRow[]>([]);
  const [isFiltered, setFiltered] = useState(false);

  const [editRecord, setEditRecord] = useState<ContactRow | null>(null);
  const [editMode, setEditMode]     = useState<"add" | "edit">("edit");
  const [showUpload, setShowUpload] = useState(false);
  const [page, setPage]           = useState(1);

  async function handleDeleteRows(ids: number[]) {
    await fetch("/api/contacts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    handleSave();
  }

  useEffect(() => {
    fetchAllContacts().then((data) => {
      setRows(data);
      setAllRows(data);
    });
  }, []);

  function handleTableUpdate(newRows: ContactRow[]) {
    setRows(newRows);
    setFiltered(true);
    setPage(1);
  }

  function handleReset() {
    setRows(allRows);
    setFiltered(false);
    setPage(1);
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

  function handleSave() {
    fetchAllContacts().then((data) => {
      setRows(data);
      setAllRows(data);
      setFiltered(false);
      setPage(1);
    });
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <div className="flex-1 flex flex-col border-r border-gray-200 min-w-0 overflow-hidden">
        <ContactsTable
          rows={rows}
          isFiltered={isFiltered}
          page={page}
          onPageChange={setPage}
          onReset={handleReset}
          onEdit={handleEdit}
          onAdd={handleAdd}
          onUpload={() => setShowUpload(true)}
          onDeleteRows={handleDeleteRows}
        />
      </div>

      <div className="w-[400px] flex-shrink-0 flex flex-col overflow-hidden shadow-lg">
        <ChatPanel
          sessionId={sessionId}
          currentRows={rows}
          onTableUpdate={handleTableUpdate}
        />
      </div>

      {editRecord !== null || editMode === "add" ? (
        <EditModal
          record={editRecord}
          mode={editMode}
          onClose={handleModalClose}
          onSave={handleSave}
        />
      ) : null}

      {showUpload ? (
        <CSVUploadModal
          onClose={() => setShowUpload(false)}
          onUpload={() => {
            setShowUpload(false);
            handleSave();
          }}
        />
      ) : null}
    </div>
  );
}

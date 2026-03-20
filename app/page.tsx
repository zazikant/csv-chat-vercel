"use client";

import { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import ContactsTable from "@/components/ContactsTable";
import ChatPanel from "@/components/ChatPanel";
import { ContactRow } from "@/lib/langgraph/state";

async function fetchAllContacts(): Promise<ContactRow[]> {
  const res = await fetch("/api/contacts");
  if (!res.ok) return [];
  return res.json();
}

export default function HomePage() {
  const [sessionId]               = useState(() => uuidv4());
  const [rows, setRows]           = useState<ContactRow[]>([]);
  const [allRows, setAllRows]     = useState<ContactRow[]>([]);
  const [isFiltered, setFiltered] = useState(false);

  useEffect(() => {
    fetchAllContacts().then((data) => {
      setRows(data);
      setAllRows(data);
    });
  }, []);

  function handleTableUpdate(newRows: ContactRow[]) {
    setRows(newRows);
    setFiltered(true);
  }

  function handleReset() {
    setRows(allRows);
    setFiltered(false);
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <div className="flex-1 flex flex-col border-r border-gray-200 min-w-0 overflow-hidden">
        <ContactsTable
          rows={rows}
          isFiltered={isFiltered}
          onReset={handleReset}
        />
      </div>

      <div className="w-[400px] flex-shrink-0 flex flex-col overflow-hidden shadow-lg">
        <ChatPanel
          sessionId={sessionId}
          onTableUpdate={handleTableUpdate}
        />
      </div>
    </div>
  );
}

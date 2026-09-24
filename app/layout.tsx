import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CSV Chat",
  description: "Chat with your contacts data using LangGraph + Supabase",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}

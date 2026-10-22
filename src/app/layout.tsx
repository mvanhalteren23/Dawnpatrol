import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dawn Patrol Co.",
  description: "AI receptionists that never miss a call — CRM & client portal",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

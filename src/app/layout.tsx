import type { Metadata } from "next";
import { companyName } from "@/lib/brand";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await companyName(), description: "AI receptionists that never miss a call — CRM & client portal" };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

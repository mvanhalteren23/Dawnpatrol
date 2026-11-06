import type { Metadata } from "next";
import { companyName } from "@/lib/brand";
import { SITE_URL } from "@/lib/seo";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const name = await companyName();
  return {
    metadataBase: new URL(SITE_URL),
    title: name,
    description: "AI receptionists that never miss a call — CRM & client portal",
    openGraph: { siteName: name, locale: "en_CA", type: "website" },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600;700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}

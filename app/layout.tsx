import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { SiteNav } from "@/components/ui/SiteNav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // Pages set just their own name; the template appends the app's.
  title: {
    default: "InvoiceGen — GST invoices",
    template: "%s · InvoiceGen",
  },
  description:
    "Create GST-compliant tax invoices for Indian businesses, and download them as clean PDFs.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-stone-50 text-stone-900">
        <SiteNav />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
          {children}
        </main>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { AppSidebar } from "@/components/ui/AppSidebar";
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
      <body className="min-h-full bg-ink-50 text-ink-900">
        <AppSidebar />

        {/* `lg:pl-64` clears the fixed rail. Below `lg` the rail is gone and the
            content runs full width under the sticky bar. */}
        <div className="lg:pl-64">
          <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}

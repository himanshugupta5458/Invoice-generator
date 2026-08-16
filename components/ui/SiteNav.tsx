"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "./cn";

const LINKS = [
  { href: "/", label: "New invoice" },
  { href: "/invoices", label: "History" },
  { href: "/settings", label: "Settings" },
] as const;

/** App chrome stays neutral so business accent colours never fight it (§9). */
export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="text-sm font-semibold tracking-tight text-stone-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
        >
          InvoiceGen
        </Link>

        <nav aria-label="Main" className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm transition-colors motion-reduce:transition-none",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900",
                  active
                    ? "bg-stone-100 font-medium text-stone-900"
                    : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

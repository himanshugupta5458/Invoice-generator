"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cn } from "./cn";
import {
  ClockIcon,
  FilePlusIcon,
  MenuIcon,
  ReceiptIcon,
  SlidersIcon,
  XIcon,
} from "./icons";

/**
 * The whole of the app's navigation (§9). The rail is `w-64`; the main column
 * in app/layout.tsx offsets itself by the same `lg:pl-64`.
 */
const LINKS = [
  { href: "/", label: "New invoice", Icon: FilePlusIcon },
  { href: "/invoices", label: "History", Icon: ClockIcon },
  { href: "/settings", label: "Settings", Icon: SlidersIcon },
] as const;

function isActive(pathname: string, href: string): boolean {
  // "/" would prefix-match everything, so the builder is an exact match only.
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Wordmark({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="focus-ring -m-1.5 flex items-center gap-2.5 rounded-lg p-1.5"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm"
      >
        <ReceiptIcon className="size-5" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[0.9375rem] font-semibold tracking-tight text-ink-900">
          InvoiceGen
        </span>
        <span className="mt-1 text-[0.6875rem] font-medium tracking-wide text-ink-500">
          GST invoicing
        </span>
      </span>
    </Link>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="px-3">
      <ul className="flex flex-col gap-0.5">
        {LINKS.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="relative">
              {/* Sits in the rail's gutter rather than inside the pill, so the
                  label never shifts as the active item changes. */}
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-y-1.5 -left-3 w-[3px] rounded-r-full bg-brand-600"
                />
              )}
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
                  "transition-colors motion-reduce:transition-none",
                  active
                    ? "bg-brand-50 font-semibold text-brand-700"
                    : "font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                )}
              >
                <Icon
                  className={cn(
                    "size-5 shrink-0",
                    active ? "text-brand-600" : "text-ink-400",
                  )}
                />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Where the data lives, said once, where it is always visible.
 *
 * §7 puts everything in this browser's `localStorage` — not synced, and gone if
 * site data is cleared. That is a surprising enough property of a tool people
 * keep financial records in that it belongs in the chrome rather than buried in
 * Settings, with the route that mitigates it one click away.
 */
function StorageNote() {
  return (
    <p className="text-xs leading-relaxed text-ink-500">
      Saved in this browser only.{" "}
      <Link
        href="/settings"
        className="focus-ring rounded font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
      >
        Back up your data
      </Link>
      .
    </p>
  );
}

/**
 * App navigation (§9).
 *
 * One component renders both forms of it, because they are the same three links
 * and the same active state:
 *
 * - `lg` and up, a fixed left rail. Being fixed means it does not scroll away
 *   from a long invoice form, and the main column offsets itself by the rail's
 *   width rather than sharing a flex row with it.
 * - Below `lg`, a sticky top bar whose hamburger opens a drawer.
 *
 * The drawer is a native `<dialog>` opened with `showModal()`. That is the
 * reason to prefer it over a hand-rolled overlay: the platform supplies the
 * focus trap, the inertness of the page behind, and Escape-to-close, all of
 * which are easy to get subtly wrong by hand and are exactly what makes an
 * off-canvas menu unusable from a keyboard.
 */
export function AppSidebar() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // `open` is the source of truth; the effect drives the element. Calling
  // showModal() on an already-open dialog throws, hence the guards.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  /*
   * The drawer is `lg:hidden`. Widening past `lg` with it open would hide a
   * modal that still holds the focus trap, leaving keyboard focus somewhere the
   * user cannot see — so the breakpoint closes it.
   *
   * There is deliberately no matching effect on `pathname`. Every link the
   * drawer contains closes it on click, and while it is open the page behind is
   * inert, so no other navigation can start underneath it — a route watcher
   * would only be a second way to reach a state that is already reached.
   */
  useEffect(() => {
    const query = window.matchMedia("(min-width: 64rem)");
    const sync = () => {
      if (query.matches) setOpen(false);
    };
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return (
    <>
      {/* Desktop rail. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-ink-200 bg-white lg:flex">
        <div className="px-6 py-5">
          <Wordmark />
        </div>

        <div className="mt-2 flex-1 overflow-y-auto pb-4">
          <NavList />
        </div>

        <div className="border-t border-ink-100 px-6 py-4">
          <StorageNote />
        </div>
      </aside>

      {/* Mobile bar. Sticky so the way back to navigation is always one tap
          away, however far down a long form the user has scrolled. */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-ink-200 bg-white/85 px-4 backdrop-blur-sm lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="app-nav-drawer"
          aria-label="Open navigation menu"
          className="focus-ring -ml-2 rounded-lg p-2 text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 motion-reduce:transition-none"
        >
          <MenuIcon />
        </button>
        <Wordmark />
      </header>

      {/* Off-canvas drawer. `m-0 h-dvh` overrides the centring a dialog does by
          default and pins it to the left edge, full height. */}
      <dialog
        id="app-nav-drawer"
        ref={dialogRef}
        aria-label="Main navigation"
        onClose={close}
        // A click on the backdrop lands on the dialog itself, because the panel
        // inside fills it edge to edge.
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] bg-white p-0 backdrop:bg-ink-950/40 lg:hidden"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-5 py-4">
            <Wordmark onNavigate={close} />
            <button
              type="button"
              onClick={close}
              aria-label="Close navigation menu"
              className="focus-ring rounded-lg p-2 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 motion-reduce:transition-none"
            >
              <XIcon />
            </button>
          </div>

          <div className="mt-2 flex-1 overflow-y-auto">
            <NavList onNavigate={close} />
          </div>

          <div className="border-t border-ink-100 px-6 py-4">
            <StorageNote />
          </div>
        </div>
      </dialog>
    </>
  );
}

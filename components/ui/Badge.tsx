import type { ReactNode } from "react";

import { cn } from "./cn";

export type BadgeTone = "neutral" | "brand" | "success" | "warning";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-ink-100 text-ink-600",
  brand: "bg-brand-50 text-brand-700",
  success: "bg-green-50 text-green-800",
  warning: "bg-amber-50 text-amber-800",
};

export interface BadgeProps {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}

/**
 * A small count or state pill — "3 items", "CGST + SGST", "12 saved".
 *
 * Collected into a component because the same pill had already been written
 * three times with three different paddings. It is deliberately not the status
 * toggle in the history list: that one is a button, and a badge that can be
 * clicked but does not look like a control is worse than either.
 */
export function Badge({ tone = "neutral", className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1",
        "text-[0.6875rem] font-semibold uppercase tracking-wide whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

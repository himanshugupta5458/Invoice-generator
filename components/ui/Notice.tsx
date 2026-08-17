import type { ReactNode } from "react";

import { cn } from "./cn";

export type NoticeTone = "success" | "warning" | "danger" | "info";

/**
 * Status colours, kept apart from the brand scale on purpose: "this saved" and
 * "this failed" have to be readable as themselves, and a green that has been
 * pulled towards the brand hue stops being green.
 */
const TONES: Record<NoticeTone, string> = {
  success: "border-green-200 bg-green-50 text-green-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-red-200 bg-red-50 text-red-900",
  info: "border-brand-200 bg-brand-50 text-brand-900",
};

export interface NoticeProps {
  tone: NoticeTone;
  /**
   * `alert` interrupts a screen-reader user immediately and is for something
   * that went wrong; `status` waits for a pause and is for something that went
   * right. Defaults to `status` — the quieter of the two.
   */
  role?: "status" | "alert";
  /** Renders a close control. Omit for a notice the user cannot act on. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** `sm` for panels nested inside a card, `md` for a banner across a page. */
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
}

/**
 * Every "it worked" / "it didn't" message in the app.
 *
 * One component because these were five near-identical blocks of border/bg/text
 * utilities that had already drifted apart in padding and text size; the point
 * of collecting them is that the app's feedback should look like one voice.
 */
export function Notice({
  tone,
  role = "status",
  onDismiss,
  dismissLabel = "Dismiss",
  size = "md",
  className,
  children,
}: NoticeProps) {
  return (
    <div
      role={role}
      className={cn(
        "flex items-start justify-between gap-3 rounded-lg border",
        size === "sm" ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm",
        "leading-relaxed",
        TONES[tone],
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          // `outline-current` rather than the brand ring: on a coloured panel
          // the ring has to contrast with *that* panel, not with white.
          className="focus-ring -mr-1 shrink-0 rounded p-1 opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-current motion-reduce:transition-none"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      )}
    </div>
  );
}

import type { ReactNode } from "react";

import { cn } from "./cn";

export interface CardProps {
  className?: string;
  children: ReactNode;
}

/**
 * The app's one surface. Every panel in the product is this: white on the
 * `ink-50` canvas, hairline border, one shared radius, one shared shadow.
 *
 * Having a single component rather than a repeated string of utilities is what
 * keeps the surfaces identical — the previous forms drifted because each
 * section carried its own copy of the border and padding classes.
 */
export function Card({ className, children }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-ink-200 bg-white shadow-[0_1px_2px_rgba(23,27,36,0.04)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface SectionCardProps extends CardProps {
  title: string;
  /** One line under the heading saying what this section is for. */
  description?: ReactNode;
  /** Controls that belong to the section, shown opposite its heading. */
  actions?: ReactNode;
  /** Set when the card holds its own edge-to-edge layout and wants no padding. */
  bare?: boolean;
  /** Rendered flush against the bottom edge, below the body's padding. */
  footer?: ReactNode;
}

/**
 * A card with a titled header.
 *
 * The header is a band rather than just a heading: the rule under it is what
 * separates "what this section is" from "what you fill in", which is the
 * distinction a tall form loses when every heading is simply another line of
 * text in the same stack.
 *
 * Headings are `h2` throughout — every page puts its own `h1` in the page
 * header, so section titles are always one level down from it.
 */
export function SectionCard({
  title,
  description,
  actions,
  bare = false,
  footer,
  className,
  children,
}: SectionCardProps) {
  // A collapsed section (Ship To, when it is "same as Bill To") has a header and
  // nothing else. Its rule would then land on top of the card's own bottom
  // border and read as a doubled line, so the rule belongs to the body, not the
  // header.
  const hasBody = Boolean(children);

  return (
    <Card className={cn("overflow-hidden", className)}>
      <div
        className={cn(
          "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-4 sm:px-6",
          (hasBody || Boolean(footer)) && "border-b border-ink-100",
        )}
      >
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-ink-900">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>

      {hasBody && (
        <div className={bare ? undefined : "px-5 py-5 sm:px-6"}>{children}</div>
      )}

      {footer && (
        <div className="border-t border-ink-100 bg-ink-50/60 px-5 py-4 sm:px-6">
          {footer}
        </div>
      )}
    </Card>
  );
}

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}

/** The `h1` block every page opens with. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-500">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Shown while the store rehydrates from `localStorage`. One component so the
 * three panels that wait on it say the same thing in the same place, rather
 * than each dropping a differently-styled "Loading…" wherever it happened to be.
 */
export function PanelLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <p role="status" className="px-5 py-8 text-center text-sm text-ink-500 sm:px-6">
      {label}
    </p>
  );
}

export interface EmptyStateProps {
  title: string;
  description: ReactNode;
  /** The one thing to do next — an empty state should direct, not decorate (§9). */
  action?: ReactNode;
  icon?: ReactNode;
  /**
   * The dashed outline that marks out a placeholder region. Turn it off when
   * this already sits inside a card, where it would only draw a box in a box.
   */
  bordered?: boolean;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  bordered = true,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "px-6 py-12 text-center",
        // Capped when it stands alone on a page: a dashed box run out to
        // 1,400px reads as a large empty area rather than as a prompt. Nested
        // in a card it takes the card's width, which is already sized.
        bordered &&
          "mx-auto max-w-2xl rounded-xl border border-dashed border-ink-300 bg-white",
      )}
    >
      {icon && (
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-500">
        {description}
      </p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

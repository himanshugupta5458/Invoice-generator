import type { ComponentPropsWithRef, ReactNode } from "react";
import { useId } from "react";

import { cn } from "./cn";

/**
 * One control surface for every input in the app.
 *
 * `h-10` is the number that matters: inputs, selects and `md` buttons all share
 * it, so a field beside a field beside a button sits on one line rather than
 * three slightly different ones. A textarea takes the same padding and border
 * but sizes from its `rows`.
 *
 * Note `cn` is a plain join, not a Tailwind-aware merge (see cn.ts): a class
 * passed through `className` does not override one baked in here, it only joins
 * it, and the stylesheet's order decides the winner. Size these controls from
 * their container, not by passing a competing `w-*` or `pr-*`.
 */
const CONTROL_BASE = cn(
  "focus-ring-inset w-full rounded-lg border border-ink-300 bg-white text-sm text-ink-900",
  "px-3 shadow-[0_1px_2px_rgba(23,27,36,0.04)]",
  "placeholder:text-ink-400",
  "transition-colors motion-reduce:transition-none",
  "hover:border-ink-400",
  "disabled:cursor-not-allowed disabled:border-ink-200 disabled:bg-ink-100 disabled:text-ink-500 disabled:shadow-none disabled:hover:border-ink-200",
  // An invalid control says so on its own border, and again on its focus ring,
  // so the state survives both a glance and a tab-through.
  "aria-invalid:border-red-400 aria-invalid:hover:border-red-500",
  "aria-invalid:focus-visible:outline-red-500",
);

const CONTROL_CLASSES = cn(CONTROL_BASE, "h-10");

export function TextInput({
  className,
  ...props
}: ComponentPropsWithRef<"input">) {
  return <input className={cn(CONTROL_CLASSES, className)} {...props} />;
}

export function TextArea({
  className,
  rows = 4,
  ...props
}: ComponentPropsWithRef<"textarea">) {
  return (
    <textarea
      rows={rows}
      className={cn(CONTROL_BASE, "py-2.5 leading-relaxed", className)}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentPropsWithRef<"select">) {
  return (
    <select
      className={cn(CONTROL_CLASSES, "select-chevron pr-8", className)}
      {...props}
    />
  );
}

/**
 * The app's checkbox. Native, with `accent-color` doing the brand tinting —
 * a custom-drawn box would have to re-implement the indeterminate state, the
 * high-contrast rendering and the platform's own focus affordance to get back
 * to where the native one already is.
 */
export function Checkbox({ className, ...props }: ComponentPropsWithRef<"input">) {
  return (
    <input
      type="checkbox"
      className={cn(
        "focus-ring size-4 shrink-0 rounded border-ink-300 accent-brand-600",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** A checkbox with its label, laid out so the whole row is the hit target. */
export function CheckboxField({
  label,
  description,
  className,
  ...props
}: ComponentPropsWithRef<"input"> & {
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 text-sm text-ink-700",
        props.disabled && "cursor-not-allowed text-ink-400",
        className,
      )}
    >
      <Checkbox {...props} className="mt-0.5" />
      <span>
        {label}
        {description && (
          <span className="mt-0.5 block text-xs text-ink-500">{description}</span>
        )}
      </span>
    </label>
  );
}

/**
 * The column grid shared by every address block in the app (Bill To, Ship To,
 * the buyer form, a business profile), so they read as the same form asked
 * again rather than as four forms that happen to collect the same thing.
 *
 * Six columns is what makes the natural pairs land: a name beside a phone (4/2),
 * an address across the full width (6), and a state beside its two-character
 * code (4/2) — a code that at half-width looked like a field someone forgot to
 * finish.
 */
export const ADDRESS_GRID = "grid gap-x-4 gap-y-4 sm:grid-cols-6";

export interface FieldProps {
  label: string;
  /** Validation error — shown in red and wired to the control via aria. */
  error?: string;
  /** Non-blocking advice shown below the control. */
  hint?: ReactNode;
  /** Non-blocking warning, e.g. the GSTIN / state-code mismatch (§4). */
  warning?: ReactNode;
  required?: boolean;
  className?: string;
  /** Receives the ids to wire onto the control. */
  children: (ids: {
    id: string;
    "aria-invalid": boolean;
    "aria-required": true | undefined;
    "aria-describedby": string | undefined;
  }) => ReactNode;
}

/**
 * Label + control + message wrapper. Takes a render prop so the control keeps
 * its own props (RHF's `register` spread) while still getting the right ids.
 *
 * Required is marked twice, for two different readers: an asterisk in the brand
 * colour for anyone scanning the form, and `aria-required` on the control for a
 * screen reader, which would otherwise hear an unexplained "star".
 *
 * `aria-required` and not a hidden "(required)" inside the `<label>`: text in
 * the label becomes part of the control's *accessible name*, so every required
 * field would answer to "Buyer name (required)" rather than "Buyer name" — which
 * is both wrong as a name and a nuisance to anything matching on one.
 * `aria-required` is announced as state, next to the name, where it belongs.
 *
 * It is `aria-required` rather than the native `required` attribute because the
 * form is `noValidate` and validated by zod (§4): the native attribute would put
 * the browser's own bubble in front of the schema's message.
 */
export function Field({
  label,
  error,
  hint,
  warning,
  required,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const noteId = `${id}-note`;
  const hasNote = Boolean(hint || warning);

  const describedBy =
    [error ? errorId : null, hasNote ? noteId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label
        htmlFor={id}
        className="text-[0.8125rem] font-medium leading-5 text-ink-700"
      >
        {label}
        {required && (
          <span className="ml-0.5 text-brand-600" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-required": required ? true : undefined,
        "aria-describedby": describedBy,
      })}

      {error && (
        <p id={errorId} className="text-xs leading-relaxed text-red-600">
          {error}
        </p>
      )}
      {hasNote && (
        <p id={noteId} className="text-xs leading-relaxed text-ink-500">
          {warning && <span className="text-amber-700">{warning}</span>}
          {warning && hint ? " " : null}
          {hint}
        </p>
      )}
    </div>
  );
}

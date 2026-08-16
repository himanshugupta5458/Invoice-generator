import type {
  ComponentPropsWithRef,
  ReactNode,
} from "react";
import { useId } from "react";

import { cn } from "./cn";

const CONTROL_CLASSES = cn(
  "w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900",
  "placeholder:text-stone-400",
  "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-stone-900",
  "disabled:cursor-not-allowed disabled:bg-stone-100",
  "aria-[invalid=true]:border-red-400",
);

export function TextInput({ className, ...props }: ComponentPropsWithRef<"input">) {
  return <input className={cn(CONTROL_CLASSES, className)} {...props} />;
}

export function TextArea({
  className,
  rows = 4,
  ...props
}: ComponentPropsWithRef<"textarea">) {
  return (
    <textarea rows={rows} className={cn(CONTROL_CLASSES, className)} {...props} />
  );
}

export function Select({
  className,
  ...props
}: ComponentPropsWithRef<"select">) {
  return <select className={cn(CONTROL_CLASSES, "pr-8", className)} {...props} />;
}

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
    "aria-describedby": string | undefined;
  }) => ReactNode;
}

/**
 * Label + control + message wrapper. Takes a render prop so the control keeps
 * its own props (RHF's `register` spread) while still getting the right ids.
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
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-stone-700">
        {label}
        {required && (
          <span className="ml-0.5 text-stone-400" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
      })}

      {error && (
        <p id={errorId} className="text-xs text-red-700">
          {error}
        </p>
      )}
      {hasNote && (
        <p id={noteId} className="text-xs text-stone-500">
          {warning && <span className="text-amber-700">{warning}</span>}
          {warning && hint ? " " : null}
          {hint}
        </p>
      )}
    </div>
  );
}

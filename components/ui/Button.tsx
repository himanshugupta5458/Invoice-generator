import type { ComponentPropsWithRef } from "react";

import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: Variant;
  size?: Size;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "border-transparent bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:hover:bg-brand-600",
  secondary:
    "border-ink-300 bg-white text-ink-800 shadow-[0_1px_2px_rgba(23,27,36,0.04)] hover:border-ink-400 hover:bg-ink-50 disabled:hover:border-ink-300 disabled:hover:bg-white",
  ghost:
    "border-transparent bg-transparent text-ink-600 hover:bg-ink-100 hover:text-ink-900",
  danger:
    "border-red-200 bg-white text-red-700 hover:border-red-300 hover:bg-red-50 disabled:hover:border-red-200 disabled:hover:bg-white",
};

/**
 * Heights, not just padding — a button next to an input has to line up with it,
 * so `md` is the same `h-10` the form controls use and `sm` the same `h-8` as
 * the compact ones.
 */
const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-10 gap-2 px-4 text-sm",
};

/** Shared so a `<Link>` acting as a button is not a second, drifting copy. */
export function buttonClasses(
  variant: Variant = "secondary",
  size: Size = "md",
  className?: string,
): string {
  return cn(
    "focus-ring inline-flex items-center justify-center rounded-lg border font-medium whitespace-nowrap",
    // Motion is a nicety, never a requirement (§9).
    "transition-colors motion-reduce:transition-none",
    "disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      {...props}
    />
  );
}

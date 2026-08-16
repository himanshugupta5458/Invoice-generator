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
    "bg-stone-900 text-white border border-stone-900 hover:bg-stone-800 disabled:hover:bg-stone-900",
  secondary:
    "bg-white text-stone-800 border border-stone-300 hover:bg-stone-100 disabled:hover:bg-white",
  ghost:
    "bg-transparent text-stone-600 border border-transparent hover:bg-stone-100 hover:text-stone-900",
  danger:
    "bg-white text-red-700 border border-red-200 hover:bg-red-50 disabled:hover:bg-white",
};

const SIZES: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-2 text-sm",
};

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
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium",
        // Motion is a nicety, never a requirement (§9).
        "transition-colors motion-reduce:transition-none",
        // Focus must stay visible for keyboard users (§9).
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}
